import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocumentStore } from '../core/doc-store';
import { Tabs, type TabChannel, type TabLocks } from './tabs';

const memory = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });

async function settle(ms = 30): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, ms / 5));
}

/** One lock per name with a queue, and `steal`, as the Web Locks API does. */
class FakeLocks implements TabLocks {
  private holder: { reject: (e: Error) => void } | undefined;
  private readonly queue: (() => void)[] = [];

  request(_name: string, options: { steal?: boolean }, callback: () => Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const entry = { reject };
      // As in browsers, the lock is ours at once but the callback runs in a later task.
      const grant = (): void => {
        this.holder = entry;
        setTimeout(() => {
          if (this.holder !== entry) return;
          void callback().then(() => {
            if (this.holder !== entry) return;
            this.holder = undefined;
            resolve();
            this.queue.shift()?.();
          });
        }, 0);
      };
      if (options.steal && this.holder) {
        const old = this.holder;
        const abort = new Error('stolen');
        abort.name = 'AbortError';
        grant();
        // Chrome runs the thief's callback before the old holder hears that it lost the lock.
        setTimeout(() => old.reject(abort), 0);
      } else if (!this.holder) grant();
      else this.queue.push(grant);
    });
  }
}

/** BroadcastChannel within one test: delivers to every other channel of the same name. */
class Hub {
  readonly channels = new Set<FakeChannel>();
  create = (name: string): TabChannel => {
    const c = new FakeChannel(this, name);
    this.channels.add(c);
    return c;
  };
}

class FakeChannel implements TabChannel {
  deaf = false;
  private readonly listeners: ((e: { data: unknown }) => void)[] = [];
  constructor(
    private readonly hub: Hub,
    private readonly name: string,
  ) {}
  postMessage(message: unknown): void {
    if (this.deaf) return;
    for (const c of this.hub.channels) {
      if (c === this || c.name !== this.name || c.deaf) continue;
      setTimeout(() => c.listeners.forEach((l) => l({ data: structuredClone(message) })), 0);
    }
  }
  addEventListener(_type: 'message', listener: (e: { data: unknown }) => void): void {
    this.listeners.push(listener);
  }
  close(): void {
    this.hub.channels.delete(this);
  }
}

function tab(id: string, locks: TabLocks | undefined, hub: Hub, events: string[], pingTimeoutMs = 60_000) {
  const store = new DocumentStore(memory);
  const tabs = new Tabs({
    store,
    name: 'test-pairing',
    tabId: id,
    locks,
    createChannel: hub.create,
    pingTimeoutMs,
    log: () => undefined,
    onLead: () => events.push(`${id} leads`),
    onFollow: () => events.push(`${id} follows`),
  });
  return { store, tabs };
}

const text = (doc: Y.Doc): string => doc.getText('t').toString();

describe('Tabs', () => {
  it('one tab leads; edits on either side reach the other', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const events: string[] = [];
    const a = tab('a', locks, hub, events);
    const b = tab('b', locks, hub, events);
    a.tabs.start();
    await settle();
    b.tabs.start();
    await settle();
    expect(events).toEqual(['a leads']);
    expect(b.tabs.isLeader).toBe(false);

    const da = await a.store.open('space/work');
    const db = await b.store.open('space/work');
    da.getText('t').insert(0, 'from a ');
    db.getText('t').insert(0, 'from b ');
    await settle(100);
    expect(text(da)).toBe(text(db));
    expect(text(da)).toContain('from a');
    expect(text(da)).toContain('from b');
  });

  it('a document opened only in the follower reaches the leader', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const a = tab('a', locks, hub, []);
    const b = tab('b', locks, hub, []);
    a.tabs.start();
    await settle();
    b.tabs.start();
    await settle();
    (await b.store.open('space/new')).getText('t').insert(0, 'only in b');
    await settle(100);
    expect(a.store.opened().has('space/new')).toBe(true);
    expect(text(await a.store.open('space/new'))).toBe('only in b');
  });

  it('the follower leads when the leader closes', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const events: string[] = [];
    const a = tab('a', locks, hub, events);
    const b = tab('b', locks, hub, events);
    a.tabs.start();
    b.tabs.start();
    await settle();
    a.tabs.close();
    await settle();
    expect(events).toEqual(['a leads', 'b leads']);
    expect(b.tabs.isLeader).toBe(true);
  });

  it('takeOver makes this tab lead and the old leader follow, and they still sync', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const events: string[] = [];
    const a = tab('a', locks, hub, events);
    const b = tab('b', locks, hub, events);
    a.tabs.start();
    b.tabs.start();
    await settle();
    await b.tabs.takeOver();
    await settle();
    expect(events.sort()).toEqual(['a follows', 'a leads', 'b leads']);
    expect(a.tabs.isLeader).toBe(false);

    const da = await a.store.open('space/work');
    const db = await b.store.open('space/work');
    da.getText('t').insert(0, 'after the switch');
    await settle(100);
    expect(text(db)).toBe('after the switch');
  });

  it('taking over right after start, before its own lock request is granted, keeps this tab leading', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const events: string[] = [];
    const a = tab('a', locks, hub, events);
    a.tabs.start();
    await a.tabs.takeOver();
    await settle();
    expect(a.tabs.isLeader).toBe(true);
    expect(events).toEqual(['a leads']);
  });

  it('a follower takes over from a leader that does not answer (frozen in the background)', async () => {
    const locks = new FakeLocks();
    const hub = new Hub();
    const events: string[] = [];
    const a = tab('a', locks, hub, events);
    a.tabs.start();
    await settle();
    for (const c of hub.channels) (c as FakeChannel).deaf = true;
    const b = tab('b', locks, hub, events, 50);
    b.tabs.start();
    await settle(150);
    expect(b.tabs.isLeader).toBe(true);
    expect(events.sort()).toEqual(['a follows', 'a leads', 'b leads']);
  });

  it('every tab leads when there are no Web Locks', async () => {
    const hub = new Hub();
    const events: string[] = [];
    tab('a', undefined, hub, events).tabs.start();
    tab('b', undefined, hub, events).tabs.start();
    expect(events).toEqual(['a leads', 'b leads']);
  });
});
