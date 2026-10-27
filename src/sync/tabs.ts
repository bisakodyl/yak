import { isValidDocId, type DocumentStore } from '../core/doc-store';
import { DocMux } from './doc-mux';

/**
 * One sync runner per browser profile (docs/sync.md, "Tabs").
 *
 * Every tab of the app holds the same device id. If each ran its own mesh, the other devices would
 * get several answers to one offer and link to whichever answered first, often a tab in the
 * background. So one tab leads (a Web Lock) and runs the mesh; the other tabs follow and exchange
 * their documents with the leader over a BroadcastChannel, with the same Yjs sync (`DocMux`) the
 * devices use with each other. The channel is same-origin and same-profile: it reaches nothing that
 * cannot already read this origin's IndexedDB.
 *
 * Without Web Locks or BroadcastChannel every tab leads, as before.
 */

/** Messages on the channel. Frames from a follower go to the leader; the leader addresses each tab. */
type TabMessage =
  | { k: 'hello'; from: string }
  | { k: 'lead'; from: string }
  | { k: 'bye'; from: string }
  | { k: 'ping'; from: string }
  | { k: 'status'; from: string; status: unknown }
  | { k: 'frame'; from: string; to?: string; data: Uint8Array };

/** The parts of the Web Locks API used here, so tests can pass their own. */
export interface TabLocks {
  request(name: string, options: { steal?: boolean }, callback: () => Promise<void>): Promise<void>;
}

export interface TabChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (e: { data: unknown }) => void): void;
  close(): void;
}

export interface TabsOptions {
  store: DocumentStore;
  /** Names the lock and the channel; the pairing's storage key, so each pairing has its own leader. */
  name: string;
  onLead(): void;
  onFollow(): void;
  /** The leader's sync status arrived (followers only). */
  onLeaderStatus?(status: unknown): void;
  /** The leader's current status, sent to a follower that pings. */
  status?(): unknown;
  log(text: string): void;
  locks?: TabLocks | undefined;
  createChannel?: ((name: string) => TabChannel) | undefined;
  tabId?: string;
  /** A follower that hears nothing from the leader this long after a ping takes over (ms). */
  pingTimeoutMs?: number;
  /** The leader forgets a follower silent this long (ms); its next frame brings it back. */
  followerIdleMs?: number;
}

function browserLocks(): TabLocks | undefined {
  const locks = (globalThis.navigator as Navigator | undefined)?.locks;
  return locks ? (locks as unknown as TabLocks) : undefined;
}

function browserChannel(): ((name: string) => TabChannel) | undefined {
  return typeof BroadcastChannel === 'function' ? (name) => new BroadcastChannel(name) : undefined;
}

export class Tabs {
  readonly id: string;
  private leading = false;
  private waiting = false;
  /** The lock request this tab leads by; a steal of our own earlier request must not demote us. */
  private current: object | undefined;
  private closed = false;
  private release: (() => void) | undefined;
  private channel: TabChannel | undefined;
  /** Leader: one sync per follower tab. */
  private readonly followers = new Map<string, { mux: DocMux; lastSeen: number }>();
  /** Follower: the sync with the leader. */
  private toLeader: { leader: string | undefined; mux: DocMux } | undefined;
  private pingTimer: ReturnType<typeof setTimeout> | undefined;
  private sweepTimer: ReturnType<typeof setInterval> | undefined;
  private readonly locks: TabLocks | undefined;

  constructor(private readonly o: TabsOptions) {
    this.id = o.tabId ?? crypto.randomUUID();
    const createChannel = o.createChannel ?? browserChannel();
    // Both are needed: a follower without a channel would never sync.
    this.locks = createChannel ? ('locks' in o ? o.locks : browserLocks()) : undefined;
    if (this.locks && createChannel) {
      this.channel = createChannel(`${o.name}:tabs`);
      this.channel.addEventListener('message', (e) => this.onMessage(e.data as TabMessage));
    }
  }

  get isLeader(): boolean {
    return this.leading;
  }

  /** Lead at once when there is no lock to share; otherwise follow until the lock is ours. */
  start(): void {
    if (!this.locks) {
      this.lead();
      return;
    }
    this.follow();
    this.queue();
    this.ping();
    this.sweepTimer = setInterval(() => this.sweep(), (this.o.followerIdleMs ?? 90_000) / 2);
  }

  /**
   * Make this tab the leader now, for example because the person acts on sync here. Resolves once
   * it leads. A leader that is frozen in the background cannot hand over, so the lock is taken.
   */
  async takeOver(): Promise<void> {
    if (this.leading || !this.locks) return;
    this.o.log('taking over from another tab');
    await new Promise<void>((resolve) => {
      const token = {};
      void this.locks!.request(this.o.name, { steal: true }, () => this.held(token, resolve)).catch((e: unknown) => this.lost(token, e));
    });
  }

  /** Followers re-check that a leader answers when this tab is shown (background tabs may be frozen). */
  ping(): void {
    if (this.leading || !this.channel || this.closed) return;
    clearTimeout(this.pingTimer);
    this.post({ k: 'ping', from: this.id });
    this.pingTimer = setTimeout(() => {
      this.o.log('no answer from the tab that syncs');
      void this.takeOver();
    }, this.o.pingTimeoutMs ?? 2000);
  }

  /** The leader tells the followers its status after every change. */
  publishStatus(status: unknown): void {
    if (this.leading) this.post({ k: 'status', from: this.id, status });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.pingTimer);
    clearInterval(this.sweepTimer);
    this.post({ k: 'bye', from: this.id });
    this.release?.();
    for (const f of this.followers.values()) f.mux.close();
    this.followers.clear();
    this.toLeader?.mux.close();
    this.channel?.close();
  }

  // ---- leadership ----------------------------------------------------------------------------------

  private queue(): void {
    if (this.waiting || this.closed) return;
    this.waiting = true;
    const token = {};
    void this.locks!.request(this.o.name, {}, () => {
      this.waiting = false;
      return this.held(token);
    }).catch((e: unknown) => {
      this.waiting = false;
      this.lost(token, e);
    });
  }

  /** The lock is ours until the tab closes or another tab takes it. */
  private held(token: object, onHeld?: () => void): Promise<void> {
    return new Promise<void>((resolve) => {
      this.current = token;
      this.release = resolve;
      if (this.closed) {
        resolve();
        return;
      }
      if (!this.leading) this.lead();
      onHeld?.();
    });
  }

  /** Another tab took the lock: follow it, and wait for the lock again. */
  private lost(token: object, e: unknown): void {
    if (this.closed) return;
    // This tab's own takeover replaced an earlier request of ours: still leading.
    if (this.leading && token !== this.current) return;
    if (!(e instanceof Error && e.name === 'AbortError')) this.o.log(`lock: ${e instanceof Error ? e.message : String(e)}`);
    if (this.leading) {
      this.leading = false;
      this.o.log('another tab took over syncing');
      this.follow();
      this.o.onFollow();
    }
    this.queue();
  }

  private lead(): void {
    this.leading = true;
    clearTimeout(this.pingTimer);
    this.toLeader?.mux.close();
    this.toLeader = undefined;
    this.o.log('this tab syncs for the browser');
    this.post({ k: 'lead', from: this.id });
    this.o.onLead();
  }

  private follow(): void {
    for (const f of this.followers.values()) f.mux.close();
    this.followers.clear();
    this.connectToLeader(undefined);
    this.post({ k: 'hello', from: this.id });
  }

  // ---- channel -------------------------------------------------------------------------------------

  private post(m: TabMessage): void {
    try {
      this.channel?.postMessage(m);
    } catch {
      // A closed channel: nothing to tell.
    }
  }

  private onMessage(m: TabMessage): void {
    if (this.closed || !m || typeof m !== 'object' || typeof m.from !== 'string' || m.from === this.id) return;
    if (this.leading) this.asLeader(m);
    else this.asFollower(m);
  }

  private asLeader(m: TabMessage): void {
    switch (m.k) {
      case 'hello':
        this.followers.get(m.from)?.mux.close();
        this.followers.delete(m.from);
        this.follower(m.from);
        return;
      case 'bye':
        this.followers.get(m.from)?.mux.close();
        this.followers.delete(m.from);
        return;
      case 'ping':
        this.post({ k: 'lead', from: this.id });
        this.post({ k: 'status', from: this.id, status: this.o.status?.() });
        return;
      case 'frame':
        if (m.to === undefined && m.data instanceof Uint8Array) this.follower(m.from).mux.receive(m.data);
        return;
      default:
        return;
    }
  }

  private asFollower(m: TabMessage): void {
    switch (m.k) {
      case 'lead':
        clearTimeout(this.pingTimer);
        if (this.toLeader && this.toLeader.leader === undefined) {
          // A leader that did not know this tab yet (it just took over): introduce ourselves again.
          this.toLeader.leader = m.from;
          this.post({ k: 'hello', from: this.id });
        } else if (this.toLeader?.leader !== m.from) this.connectToLeader(m.from);
        return;
      case 'status':
        clearTimeout(this.pingTimer);
        if (m.status !== undefined) this.o.onLeaderStatus?.(m.status);
        return;
      case 'frame':
        if (m.to !== this.id || !(m.data instanceof Uint8Array)) return;
        clearTimeout(this.pingTimer);
        if (this.toLeader && this.toLeader.leader === undefined) this.toLeader.leader = m.from;
        else if (this.toLeader?.leader !== m.from) this.connectToLeader(m.from);
        this.toLeader?.mux.receive(m.data);
        return;
      default:
        return;
    }
  }

  /** Leader: the sync with one follower tab, made on first contact. */
  private follower(tab: string): { mux: DocMux; lastSeen: number } {
    let f = this.followers.get(tab);
    if (!f) {
      const mux = new DocMux(this.o.store, (data) => this.post({ k: 'frame', from: this.id, to: tab, data }), { allowDoc: isValidDocId });
      f = { mux, lastSeen: Date.now() };
      this.followers.set(tab, f);
      mux.start();
    }
    f.lastSeen = Date.now();
    return f;
  }

  /** Follower: a fresh sync with the leader (a new leader knows nothing of the old exchange). */
  private connectToLeader(leader: string | undefined): void {
    this.toLeader?.mux.close();
    const mux = new DocMux(this.o.store, (data) => this.post({ k: 'frame', from: this.id, data }), { allowDoc: isValidDocId });
    this.toLeader = { leader, mux };
    mux.start();
  }

  /** Leader: forget followers that went quiet (closed or frozen); a follower re-syncs every 30 s. */
  private sweep(): void {
    if (!this.leading) return;
    const idle = this.o.followerIdleMs ?? 90_000;
    for (const [tab, f] of this.followers) {
      if (Date.now() - f.lastSeen > idle) {
        f.mux.close();
        this.followers.delete(tab);
      }
    }
  }
}
