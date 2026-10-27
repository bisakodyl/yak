import { announceBlobStored, type BlobStore } from '../core/blobs/store';
import { PIECE_SIZE, pieceCount, pieceHashes, pieceListHash, pieceRange, sha256Hex } from '../core/blobs/pieces';
import { sniffImage } from '../core/blobs/sniff';
import { decodeFilePiece, encodeControl, encodeFilePiece } from './doc-mux';

/**
 * Files between devices (#166 slice 2, docs/architecture.md "Files in notes" "Transfer"). Pull, not push: a
 * device that keeps a space and lacks the bytes of an indexed file asks each directly connected peer
 * that may have it, checks the peer's piece-hash list against the index, and fetches 60 KiB pieces
 * (a window per peer, spread over every peer that has the file). Each piece is verified as it
 * arrives and stored, so a dropped link resumes. Frames go on direct links only, never the relay.
 */

/** A file the index lists and this device does not hold. */
export interface WantedFile {
  unit: string;
  hash: string;
  size: number;
  /** The index's `pieces` value; absent on entries written before file transfer. */
  pieces?: string;
}

export interface FileHost {
  /** Files to fetch, in the order to fetch them. */
  wanted(): Promise<WantedFile[]>;
  store(unit: string): BlobStore;
  /** May this peer be sent files of this unit (and be asked for them)? The same rule as `allowsDoc`. */
  allow(unit: string, peerId: string): boolean;
  /** Called when `wanted()` may have changed. Returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  log?(text: string): void;
}

/** Pieces requested per peer at once; keeps the link queue holding about 0.5 MB of file ahead of a Yjs update. */
export const WINDOW = 8;
/** Files fetched at once. */
const ACTIVE = 2;
/** A peer that sent nothing for this long is dropped from a file for a while. */
const STALL_MS = 20_000;
/** A peer that failed or had no copy is not asked again for this long. */
const BACKOFF_MS = 30_000;
const TICK_MS = 5_000;
/** At most this many indices in one `file-get`. */
const MAX_GET = 16;

type PeerState = { state: 'asked' | 'have' | 'idle'; until: number; lastAt: number; inflight: Set<number> };

interface Job {
  file: WantedFile;
  n: number;
  got: Map<number, Uint8Array>;
  list: string[] | undefined;
  peers: Map<string, PeerState>;
  loaded: boolean;
  done: boolean;
}

const key = (unit: string, hash: string): string => `${unit}/${hash}`;
const HEX64 = /^[0-9a-f]{64}$/;

export class FileTransfer {
  private readonly direct = new Map<string, (frame: Uint8Array) => void>();
  private readonly jobs = new Map<string, Job>();
  /** Piece-hash lists of files this device served lately. */
  private readonly served = new Map<string, { size: number; list: string[] }>();
  private unsubscribe: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pumping = false;
  private again = false;

  constructor(
    private readonly host: FileHost,
    private readonly now: () => number = Date.now,
  ) {}

  start(): void {
    this.unsubscribe = this.host.onChange(() => this.kick());
    this.timer = setInterval(() => this.tick(), TICK_MS);
    this.kick();
  }

  close(): void {
    this.unsubscribe?.();
    clearInterval(this.timer);
    this.jobs.clear();
    this.direct.clear();
  }

  /** A direct link to the peer opened. `send` must write to that link only. */
  peerDirect(peerId: string, send: (frame: Uint8Array) => void): void {
    this.direct.set(peerId, send);
    this.kick();
  }

  peerGone(peerId: string): void {
    this.direct.delete(peerId);
    for (const j of this.jobs.values()) j.peers.delete(peerId);
    this.kick();
  }

  /** Is any direct link open? (The placeholder text depends on it.) */
  get connected(): boolean {
    return this.direct.size > 0;
  }

  /** Re-check what is wanted and who can send it. */
  kick(): void {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    void this.pump().finally(() => {
      this.pumping = false;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    });
  }

  // ---- receiving frames --------------------------------------------------------------------

  /** A control message `file-*` from a peer with a direct link. Returns true when it was one. */
  onControl(peerId: string, m: Record<string, unknown>): boolean {
    const kind = m.kind;
    if (typeof kind !== 'string' || !kind.startsWith('file-')) return false;
    if (!this.direct.has(peerId)) return true;
    const unit = m.unit;
    const hash = m.hash;
    if (typeof unit !== 'string' || typeof hash !== 'string' || !HEX64.test(hash)) return true;
    if (kind === 'file-want') void this.serveWant(peerId, unit, hash);
    else if (kind === 'file-get') void this.serveGet(peerId, unit, hash, m.i);
    else if (kind === 'file-have') void this.onHave(peerId, unit, hash, m);
    else if (kind === 'file-none') this.onNone(peerId, unit, hash);
    return true;
  }

  /** A piece frame from a peer with a direct link. */
  onPiece(peerId: string, frame: Uint8Array): void {
    if (!this.direct.has(peerId)) return;
    const p = decodeFilePiece(frame);
    if (p) void this.acceptPiece(peerId, p.unit, p.hash, p.index, p.bytes);
  }

  // ---- serving -----------------------------------------------------------------------------

  private async serveWant(peerId: string, unit: string, hash: string): Promise<void> {
    const send = this.direct.get(peerId);
    if (!send) return;
    const none = (): void => send(encodeControl({ kind: 'file-none', unit, hash }));
    if (!this.host.allow(unit, peerId)) return none();
    const info = await this.listOf(unit, hash).catch(() => undefined);
    if (!info) return none();
    send(encodeControl({ kind: 'file-have', unit, hash, size: info.size, pieces: info.list.join('') }));
  }

  private async listOf(unit: string, hash: string): Promise<{ size: number; list: string[] } | undefined> {
    const k = key(unit, hash);
    const cached = this.served.get(k);
    if (cached) return cached;
    const rec = await this.host.store(unit).get(hash);
    if (!rec) return undefined;
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    const info = { size: bytes.length, list: await pieceHashes(bytes) };
    this.served.set(k, info);
    if (this.served.size > 16) this.served.delete(this.served.keys().next().value as string);
    return info;
  }

  private async serveGet(peerId: string, unit: string, hash: string, indices: unknown): Promise<void> {
    const send = this.direct.get(peerId);
    if (!send || !this.host.allow(unit, peerId) || !Array.isArray(indices)) return;
    const rec = await this.host.store(unit).get(hash).catch(() => undefined);
    if (!rec) return;
    const want = indices.filter((i): i is number => Number.isInteger(i) && i >= 0).slice(0, MAX_GET);
    const bytes = new Uint8Array(await rec.blob.arrayBuffer());
    for (const i of want) {
      if (i >= pieceCount(bytes.length)) continue;
      const [a, b] = pieceRange(bytes.length, i);
      // The link may have closed meanwhile: `send` is a no-op then.
      if (this.direct.get(peerId) !== send) return;
      send(encodeFilePiece(unit, hash, i, bytes.subarray(a, b)));
    }
  }

  // ---- fetching ----------------------------------------------------------------------------

  private async onHave(peerId: string, unit: string, hash: string, m: Record<string, unknown>): Promise<void> {
    const job = this.jobs.get(key(unit, hash));
    const peer = job?.peers.get(peerId);
    if (!job || !peer || peer.state !== 'asked') return;
    const text = m.pieces;
    const ok =
      m.size === job.file.size &&
      typeof text === 'string' &&
      text.length === job.n * 64 &&
      HEX64.test(text.slice(0, 64)) &&
      /^[0-9a-f]*$/.test(text);
    const list = ok ? Array.from({ length: job.n }, (_, i) => (text as string).slice(i * 64, i * 64 + 64)) : undefined;
    // A hostile peer cannot steer the download: its list must match what the index promised.
    const valid = list !== undefined && (job.file.pieces === undefined || (await pieceListHash(list)) === job.file.pieces) && (job.list === undefined || job.list.join('') === list.join(''));
    if (!valid || !list) {
      this.fail(job, peerId, 'sent a piece list that does not match');
      return;
    }
    if (job.list === undefined) {
      job.list = list;
      // Pieces kept from an earlier try count only if they fit this list.
      for (const [i, b] of [...job.got]) if ((await sha256Hex(b)) !== list[i]) job.got.delete(i);
    }
    peer.state = 'have';
    peer.lastAt = this.now();
    this.kick();
  }

  private onNone(peerId: string, unit: string, hash: string): void {
    const peer = this.jobs.get(key(unit, hash))?.peers.get(peerId);
    if (!peer) return;
    peer.state = 'idle';
    peer.until = this.now() + BACKOFF_MS * 2;
    peer.inflight.clear();
  }

  private async acceptPiece(peerId: string, unit: string, hash: string, index: number, bytes: Uint8Array): Promise<void> {
    const job = this.jobs.get(key(unit, hash));
    const peer = job?.peers.get(peerId);
    if (!job || !peer || !job.list || !peer.inflight.has(index) || job.got.has(index)) return;
    const [a, b] = pieceRange(job.file.size, index);
    if (bytes.length !== b - a || (await sha256Hex(bytes)) !== job.list[index]) {
      this.fail(job, peerId, 'sent a bad piece');
      return;
    }
    peer.lastAt = this.now();
    job.got.set(index, bytes);
    peer.inflight.delete(index);
    await this.host.store(unit).putPiece(hash, index, bytes).catch(() => undefined);
    if (job.got.size === job.n) await this.finish(job);
    else this.kick();
  }

  private async finish(job: Job): Promise<void> {
    if (job.done) return;
    job.done = true;
    const { unit, hash, size } = job.file;
    const whole = new Uint8Array(size);
    for (const [i, b] of job.got) whole.set(b, i * PIECE_SIZE);
    const store = this.host.store(unit);
    if ((await sha256Hex(whole)) !== hash) {
      // The last guard: a list that passed was wrong after all. Start this file over; the peers that vouched for it rest.
      this.host.log?.(`file ${hash.slice(0, 8)}: whole-file check failed; starting over`);
      job.got.clear();
      job.list = undefined;
      job.done = false;
      await store.deletePieces(hash).catch(() => undefined);
      for (const [id, p] of job.peers) this.fail(job, id, 'sent a file that does not match', p);
      return;
    }
    const type = sniffImage(whole) ?? 'application/octet-stream';
    await store.put(hash, new Blob([whole], { type }));
    await store.deletePieces(hash).catch(() => undefined);
    this.jobs.delete(key(unit, hash));
    this.host.log?.(`file ${hash.slice(0, 8)}: received (${size} bytes)`);
    announceBlobStored(unit, hash);
    this.kick();
  }

  private fail(job: Job, peerId: string, why: string, peer = job.peers.get(peerId)): void {
    if (!peer) return;
    this.host.log?.(`${peerId.slice(0, 8)}: ${why} for file ${job.file.hash.slice(0, 8)}; resting it`);
    peer.state = 'idle';
    peer.until = this.now() + BACKOFF_MS;
    peer.inflight.clear();
  }

  private tick(): void {
    const t = this.now();
    for (const job of this.jobs.values()) {
      for (const [id, p] of job.peers) {
        if ((p.state === 'asked' || p.inflight.size > 0) && t - p.lastAt > STALL_MS) this.fail(job, id, 'stalled');
      }
    }
    this.kick();
  }

  private async pump(): Promise<void> {
    const wanted = await this.host.wanted();
    const keys = new Set(wanted.map((w) => key(w.unit, w.hash)));
    for (const k of [...this.jobs.keys()]) if (!keys.has(k)) this.jobs.delete(k);
    const t = this.now();
    for (const w of wanted) {
      const k = key(w.unit, w.hash);
      let job = this.jobs.get(k);
      const peers = [...this.direct.keys()].filter((id) => this.host.allow(w.unit, id));
      if (w.size === 0) {
        // An empty file needs no peer.
        if ((await sha256Hex(new Uint8Array(0))) === w.hash) {
          await this.host.store(w.unit).put(w.hash, new Blob([], { type: 'application/octet-stream' }));
          announceBlobStored(w.unit, w.hash);
        }
        continue;
      }
      if (job && peers.length === 0) {
        // Nobody to ask: free the slot for a file somebody can send. Kept pieces stay in the store.
        this.jobs.delete(k);
        continue;
      }
      if (!job) {
        if (this.jobs.size >= ACTIVE || peers.length === 0) continue;
        job = { file: w, n: pieceCount(w.size), got: new Map(), list: undefined, peers: new Map(), loaded: false, done: false };
        this.jobs.set(k, job);
        const j = job;
        const kept = await this.host.store(w.unit).getPieces(w.hash).catch(() => new Map<number, Uint8Array>());
        for (const [i, b] of kept) if (i < j.n && b.length === pieceRange(w.size, i)[1] - pieceRange(w.size, i)[0]) j.got.set(i, b);
        j.loaded = true;
        if (j.got.size === j.n && j.n > 0) {
          // Every piece was kept but the file never finished (the page closed): check and store it.
          j.list = [];
          await this.finish(j);
          continue;
        }
      }
      if (!job.loaded || job.done) continue;
      for (const id of peers) {
        const send = this.direct.get(id);
        if (!send) continue;
        let p = job.peers.get(id);
        if (!p) {
          p = { state: 'idle', until: 0, lastAt: t, inflight: new Set() };
          job.peers.set(id, p);
        }
        if (p.state === 'idle' && t >= p.until) {
          p.state = 'asked';
          p.lastAt = t;
          send(encodeControl({ kind: 'file-want', unit: w.unit, hash: w.hash }));
        } else if (p.state === 'have') {
          this.request(job, p, send);
        }
      }
    }
  }

  private request(job: Job, p: PeerState, send: (frame: Uint8Array) => void): void {
    const room = WINDOW - p.inflight.size;
    if (room <= 0 || !job.list) return;
    const taken = new Set<number>();
    for (const q of job.peers.values()) for (const i of q.inflight) taken.add(i);
    const ask: number[] = [];
    for (let i = 0; i < job.n && ask.length < room; i++) if (!job.got.has(i) && !taken.has(i)) ask.push(i);
    if (ask.length === 0) return;
    for (const i of ask) p.inflight.add(i);
    p.lastAt = this.now();
    send(encodeControl({ kind: 'file-get', unit: job.file.unit, hash: job.file.hash, i: ask }));
  }
}
