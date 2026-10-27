import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import type * as Y from 'yjs';
import { isValidDocId, type DocumentStore } from '../core/doc-store';
import { DocSync } from './doc-sync';

/** Frame type: a Yjs sync message for one document. */
const FRAME_DOC_SYNC = 1;
/** Frame type: a control message between devices of the account (JSON), such as a new sync code. */
const FRAME_CONTROL = 2;
/** Frame type: one piece of a file (file-transfer.ts); only ever sent on a direct link. */
export const FRAME_FILE_PIECE = 4;
// 3 is taken by the link layer for pieces of a split message (link-chunks.ts).

export interface DocMuxOptions {
  /** Which document ids a peer may make this device open. Default: any valid `space/…` id. */
  allowDoc?: (id: string) => boolean;
  /** A document started syncing with the peer. */
  onAttach?: (id: string) => void;
  /** A frame arrived from the peer for an allowed document. */
  onReceived?: (id: string) => void;
  onError?: (error: unknown) => void;
  /** Re-run each document's state exchange after this delay, then on the interval (ms). */
  firstResyncMs?: number;
  resyncMs?: number;
}

export function encodeFrame(docId: string, payload: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, FRAME_DOC_SYNC);
  encoding.writeVarString(enc, docId);
  encoding.writeUint8Array(enc, payload);
  return encoding.toUint8Array(enc);
}

/** A control message for the other device's sync service, not for a document. */
export function encodeControl(message: Record<string, unknown>): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, FRAME_CONTROL);
  encoding.writeVarString(enc, JSON.stringify(message));
  return encoding.toUint8Array(enc);
}

/** The control message in a frame, or undefined when the frame is something else or not valid. */
export function decodeControl(frame: Uint8Array): Record<string, unknown> | undefined {
  try {
    const dec = decoding.createDecoder(frame);
    if (decoding.readVarUint(dec) !== FRAME_CONTROL) return undefined;
    const value: unknown = JSON.parse(decoding.readVarString(dec));
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** A piece of file `hash` of `unit`: the header is about 100 bytes, so a 60 KiB piece stays under one link piece. */
export function encodeFilePiece(unit: string, hash: string, index: number, bytes: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, FRAME_FILE_PIECE);
  encoding.writeVarString(enc, unit);
  encoding.writeVarString(enc, hash);
  encoding.writeVarUint(enc, index);
  encoding.writeUint8Array(enc, bytes);
  return encoding.toUint8Array(enc);
}

/** The piece in a frame, or undefined when the frame is something else or not valid. */
export function decodeFilePiece(frame: Uint8Array): { unit: string; hash: string; index: number; bytes: Uint8Array } | undefined {
  try {
    const dec = decoding.createDecoder(frame);
    if (decoding.readVarUint(dec) !== FRAME_FILE_PIECE) return undefined;
    const unit = decoding.readVarString(dec);
    const hash = decoding.readVarString(dec);
    const index = decoding.readVarUint(dec);
    return { unit, hash, index, bytes: decoding.readTailAsUint8Array(dec) };
  } catch {
    return undefined;
  }
}

export function decodeFrame(frame: Uint8Array): { docId: string; payload: Uint8Array } | undefined {
  const dec = decoding.createDecoder(frame);
  if (decoding.readVarUint(dec) !== FRAME_DOC_SYNC) return undefined;
  const docId = decoding.readVarString(dec);
  return { docId, payload: decoding.readTailAsUint8Array(dec) };
}

/**
 * Runs one Yjs sync per open document over a single data channel. Every frame names its document;
 * a frame for a document this device has not opened yet opens it (if allowed) and is delivered
 * once it is loaded. New documents opened later on either side join automatically.
 */
export class DocMux {
  private readonly syncs = new Map<string, DocSync>();
  private readonly pending = new Map<string, Uint8Array[]>();
  /** Documents the peer offered that this device does not sync with it; logged once each. */
  private readonly refused = new Set<string>();
  private readonly allowDoc: (id: string) => boolean;
  private stopListening: (() => void) | undefined;
  private firstTimer: ReturnType<typeof setTimeout> | undefined;
  private interval: ReturnType<typeof setInterval> | undefined;
  private closed = false;

  constructor(
    private readonly store: DocumentStore,
    private readonly send: (frame: Uint8Array) => void,
    private readonly options: DocMuxOptions = {},
  ) {
    this.allowDoc = options.allowDoc ?? ((id) => isValidDocId(id) && id.startsWith('space/'));
  }

  start(): void {
    for (const [id, doc] of this.store.opened()) this.attach(id, doc);
    this.stopListening = this.store.onOpened((id, doc) => this.attach(id, doc));
    this.firstTimer = setTimeout(() => this.resync(), this.options.firstResyncMs ?? 1000);
    this.interval = setInterval(() => this.resync(), this.options.resyncMs ?? 30_000);
  }

  receive(frame: Uint8Array): void {
    if (this.closed) return;
    let decoded: ReturnType<typeof decodeFrame>;
    try {
      decoded = decodeFrame(frame);
    } catch (e) {
      this.options.onError?.(e);
      return;
    }
    if (!decoded) return;
    const { docId, payload } = decoded;
    if (!this.allowDoc(docId)) {
      if (!this.refused.has(docId)) {
        this.refused.add(docId);
        this.options.onError?.(new Error(`not syncing ${docId} with this device`));
      }
      return;
    }
    this.options.onReceived?.(docId);
    const sync = this.syncs.get(docId);
    if (sync) {
      sync.receive(payload);
      return;
    }
    const queue = this.pending.get(docId) ?? [];
    queue.push(payload);
    this.pending.set(docId, queue);
    this.store.open(docId).catch((e) => this.options.onError?.(e));
  }

  /** Re-run the state exchange for every document; repairs anything lost in transit. */
  resync(): void {
    for (const s of this.syncs.values()) s.start();
  }

  /** Per document, the operations this device has that the peer's last announced state lacks (see `DocSync.missingOnPeer`). */
  missingOnPeer(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, s] of this.syncs) {
      const n = s.missingOnPeer();
      if (n !== undefined) out.set(id, n);
    }
    return out;
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.firstTimer);
    clearInterval(this.interval);
    this.stopListening?.();
    for (const s of this.syncs.values()) s.close();
    this.syncs.clear();
    this.pending.clear();
  }

  isSyncMessageOrigin(origin: unknown): boolean {
    return origin instanceof DocSync;
  }

  private attach(id: string, doc: Y.Doc): void {
    if (this.closed || this.syncs.has(id) || !this.allowDoc(id)) return;
    const sync = new DocSync(doc, (payload) => this.send(encodeFrame(id, payload)), this.options.onError);
    this.syncs.set(id, sync);
    sync.start();
    this.options.onAttach?.(id);
    for (const payload of this.pending.get(id) ?? []) sync.receive(payload);
    this.pending.delete(id);
  }
}
