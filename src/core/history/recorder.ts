import * as Y from 'yjs';
import type { SegmentStore } from './types';

/** Updates are merged into one segment after at most this long. */
const FLUSH_MS = 60_000;

interface Watched {
  doc: Y.Doc;
  pending: Uint8Array[];
  first: number;
  last: number;
  local: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  stop(): void;
}

/**
 * Writes a document's change log. Updates are collected as they happen and flushed as one merged
 * segment after `FLUSH_MS` of editing, or when `flushAll` is called (page hidden, shutdown). The
 * first time a document is recorded, its whole state becomes the baseline segment, so the log can
 * replay from there.
 */
export class HistoryRecorder {
  private readonly watched = new Map<string, Watched>();

  constructor(
    private readonly store: SegmentStore,
    private readonly now: () => number = Date.now,
    private readonly flushMs: number = FLUSH_MS,
  ) {}

  async attach(docId: string, doc: Y.Doc): Promise<void> {
    if (this.watched.has(docId)) return;
    const w: Watched = { doc, pending: [], first: 0, last: 0, local: false, timer: undefined, stop: () => undefined };
    const onUpdate = (update: Uint8Array, origin: unknown): void => {
      const t = this.now();
      if (w.pending.length === 0) w.first = t;
      w.last = t;
      w.pending.push(update);
      // Edits made here have no origin (or an undo manager); a link or a restore from storage sets its own.
      if (origin === null || origin === undefined || origin instanceof Y.UndoManager || origin === HISTORY_RESTORE) w.local = true;
      w.timer ??= setTimeout(() => void this.flush(docId), this.flushMs);
    };
    doc.on('update', onUpdate);
    w.stop = () => doc.off('update', onUpdate);
    this.watched.set(docId, w);
    // Registered first, so nothing is missed while the log is read; a baseline that also holds a
    // pending update is harmless because applying an update twice changes nothing.
    if ((await this.store.list(docId)).length === 0) {
      const t = this.now();
      await this.store.append({ docId, start: t, end: t, update: Y.encodeStateAsUpdate(doc), local: false, baseline: true });
    }
  }

  async flush(docId: string): Promise<void> {
    const w = this.watched.get(docId);
    if (!w) return;
    clearTimeout(w.timer);
    w.timer = undefined;
    if (w.pending.length === 0) return;
    const { pending, first, last, local } = w;
    w.pending = [];
    w.local = false;
    await this.store.append({ docId, start: first, end: last, update: Y.mergeUpdates(pending), local, baseline: false });
  }

  async flushAll(): Promise<void> {
    await Promise.all([...this.watched.keys()].map((id) => this.flush(id)));
  }

  detachAll(): void {
    for (const w of this.watched.values()) {
      clearTimeout(w.timer);
      w.stop();
    }
    this.watched.clear();
  }
}

/** Transaction origin of an edit made by restoring from history; it counts as a local edit. */
export const HISTORY_RESTORE = 'history-restore';
