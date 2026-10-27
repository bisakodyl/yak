import * as Y from 'yjs';
import { collection } from '../schema';
import { BULK_EDIT } from '../bulk';
import { HISTORY_RESTORE } from './recorder';

/**
 * Notices a batch of damage to time entries: many deleted, or many older entries changed, within a
 * short window. Imports and restores never trigger it (they create records, or carry their own
 * origin). The alert says when to look: just before the first change of the batch.
 */

export interface Thresholds {
  /** Entries deleted within the window. */
  deleted: number;
  /** Entries that started more than `oldDays` ago and were changed within the window. */
  changed: number;
  oldDays: number;
  windowMs: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = { deleted: 10, changed: 25, oldDays: 14, windowMs: 60_000 };

export interface BatchAlert {
  docId: string;
  /** When the alert was raised. */
  at: number;
  deleted: number;
  changed: number;
  /** The batch came from edits on this device (otherwise it arrived from another device). */
  local: boolean;
  /** A moment before the batch began: compare from here. */
  before: number;
}

const DAY = 86_400_000;
/** One minute for the segment that holds the batch, and a second of margin. */
const BEFORE_MARGIN_MS = 61_000;
/** Origins of changes that are meant: a restore from a backup or from history, and a bulk edit. */
const MEANT = new Set<unknown>(['backup-restore', HISTORY_RESTORE, BULK_EDIT]);

/** Undoing a bulk edit puts back what the person chose to change, so it is as meant as the edit. */
const isMeant = (origin: unknown): boolean => MEANT.has(origin) || (origin instanceof Y.UndoManager && origin.trackedOrigins.has(BULK_EDIT));

interface Hit {
  t: number;
  id: string;
  deleted: boolean;
  old: boolean;
  local: boolean;
}

export class CorruptionWatch {
  private hits: Hit[] = [];
  private readonly stops: (() => void)[] = [];

  constructor(
    private readonly onAlert: (alert: BatchAlert) => void,
    private readonly thresholds: () => Thresholds = () => DEFAULT_THRESHOLDS,
    private readonly now: () => number = Date.now,
  ) {}

  attach(docId: string, doc: Y.Doc): void {
    const entries = collection(doc, 'time_entries');
    const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
      if (isMeant(tr.origin)) return;
      const local = tr.local;
      const t = this.now();
      const th = this.thresholds();
      for (const ev of events) {
        // Events on a record's own map (path: [record id]); records added or removed whole are not damage.
        if (ev.path.length !== 1 || !(ev instanceof Y.YMapEvent)) continue;
        const changed = [...ev.keysChanged].filter((k) => k !== 'updated_at');
        if (changed.length === 0) continue;
        const id = String(ev.path[0]);
        const rec = ev.target;
        const start = Date.parse(String(rec.get('start') ?? ''));
        this.hits.push({
          t,
          id,
          deleted: ev.keysChanged.has('deleted') && rec.get('deleted') === true,
          old: Number.isFinite(start) && start < t - th.oldDays * DAY,
          local,
        });
      }
      this.check(docId, th, t);
    };
    entries.observeDeep(handler);
    this.stops.push(() => entries.unobserveDeep(handler));
  }

  private check(docId: string, th: Thresholds, t: number): void {
    this.hits = this.hits.filter((h) => t - h.t <= th.windowMs);
    const deleted = new Set(this.hits.filter((h) => h.deleted).map((h) => h.id));
    const changed = new Set(this.hits.filter((h) => h.old).map((h) => h.id));
    if (deleted.size < th.deleted && changed.size < th.changed) return;
    const first = Math.min(...this.hits.map((h) => h.t));
    const alert: BatchAlert = { docId, at: t, deleted: deleted.size, changed: changed.size, local: this.hits.some((h) => h.local), before: first - BEFORE_MARGIN_MS };
    this.hits = [];
    this.onAlert(alert);
  }

  detach(): void {
    for (const stop of this.stops.splice(0)) stop();
    this.hits = [];
  }
}
