import * as Y from 'yjs';
import { type CollectionName, collection, nowIso } from '../schema';
import { HISTORY_RESTORE } from './recorder';
import type { Segment, SegmentStore } from './types';

/**
 * The document as this device knew it at `at`: the segments that began by then, replayed in order.
 * A segment spans up to a minute of editing and cannot be split, so the state is right to about a
 * minute. `before` is true when `at` is earlier than the log begins (the state is then empty).
 */
export async function stateAt(store: SegmentStore, docId: string, at: number): Promise<{ doc: Y.Doc; before: boolean; since: number | null }> {
  const segments = await store.list(docId);
  return { ...replay(segments, at), since: segments[0]?.start ?? null };
}

export function replay(segments: readonly Segment[], at: number): { doc: Y.Doc; before: boolean } {
  const doc = new Y.Doc();
  let applied = 0;
  for (const s of segments) {
    if (s.start > at) break;
    Y.applyUpdate(doc, s.update);
    applied++;
  }
  return { doc, before: applied === 0 };
}

// ---- Comparing a past state with now

/** Fields that change on every edit or say nothing about the content. */
const IGNORED = new Set(['updated_at', 'restored_at']);

interface FieldChange {
  field: string;
  past: unknown;
  now: unknown;
}

interface RecordChange {
  id: string;
  /** `deleted`: removed since. `changed`: edited since. `missing`: no longer in the document at all. */
  kind: 'deleted' | 'changed' | 'missing';
  fields: FieldChange[];
  past: Record<string, unknown>;
  now: Record<string, unknown> | null;
}

export interface Comparison {
  changes: RecordChange[];
  /** Records that exist now and did not exist then. */
  addedSince: number;
}

function plain(record: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  record.forEach((v, k) => {
    out[k] = v instanceof Y.AbstractType ? v.toJSON() : v;
  });
  return out;
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What differs between a past state of a collection and the present one, record by record. */
export function compareCollection(past: Y.Doc, current: Y.Doc, name: CollectionName): Comparison {
  const then = collection(past, name);
  const now = collection(current, name);
  const changes: RecordChange[] = [];
  then.forEach((rec, id) => {
    const before = plain(rec);
    if (before.deleted === true) return; // not a live record then: nothing to bring back
    const cur = now.get(id);
    if (!cur) {
      changes.push({ id, kind: 'missing', fields: [], past: before, now: null });
      return;
    }
    const after = plain(cur);
    if (after.deleted === true) {
      changes.push({ id, kind: 'deleted', fields: [{ field: 'deleted', past: false, now: true }], past: before, now: after });
      return;
    }
    const fields: FieldChange[] = [];
    for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
      if (!IGNORED.has(field) && !same(before[field], after[field])) fields.push({ field, past: before[field], now: after[field] });
    }
    if (fields.length > 0) changes.push({ id, kind: 'changed', fields, past: before, now: after });
  });
  let addedSince = 0;
  now.forEach((rec, id) => {
    if (!then.has(id) && rec.get('deleted') !== true) addedSince++;
  });
  return { changes, addedSince };
}

/**
 * Bring chosen records back as new edits: a deleted or removed record returns, an edited one gets
 * its old field values. Nothing else is touched, and each restored record says when it came back
 * (`restored_at`). Returns how many records were restored.
 */
export function restoreRecords(current: Y.Doc, past: Y.Doc, name: CollectionName, ids: readonly string[], when: string = nowIso()): number {
  const then = collection(past, name);
  const now = collection(current, name);
  let n = 0;
  current.transact(() => {
    for (const id of ids) {
      const old = then.get(id);
      if (!old) continue;
      const before = plain(old);
      let rec = now.get(id);
      if (!rec) {
        rec = new Y.Map<unknown>();
        now.set(id, rec);
      }
      for (const [field, value] of Object.entries(before)) {
        if (field === 'updated_at' || field === 'restored_at') continue;
        const cur = rec.get(field);
        if (field === 'text' && typeof value === 'string') {
          // Note text is a Y.Text: edit it in place so concurrent typing elsewhere merges.
          if (cur instanceof Y.Text) {
            const edit = minimalEdit(cur.toString(), value);
            if (edit.remove > 0) cur.delete(edit.index, edit.remove);
            if (edit.insert) cur.insert(edit.index, edit.insert);
          } else rec.set(field, new Y.Text(value));
        } else if (!same(cur, value)) rec.set(field, value);
      }
      // A field the record has now and had not then is removed from the record's meaning by resetting it.
      for (const field of [...rec.keys()]) {
        if (!(field in before) && !IGNORED.has(field)) rec.delete(field);
      }
      rec.set('updated_at', when);
      rec.set('restored_at', when);
      n++;
    }
  }, HISTORY_RESTORE);
  return n;
}

// ---- Versions of one note

export interface NoteVersion {
  /** Epoch milliseconds the text reached this form. */
  at: number;
  text: string;
  /** From a named version, which keeps its own text. */
  name?: string;
  markId?: string;
}

/** Every distinct text a note had in the log, oldest first; consecutive segments with equal text count once. */
export function noteVersions(segments: readonly Segment[], noteId: string): NoteVersion[] {
  const doc = new Y.Doc();
  const notes = doc.getMap<Y.Map<unknown>>('notes');
  const out: NoteVersion[] = [];
  let last: string | null = null;
  for (const s of segments) {
    Y.applyUpdate(doc, s.update);
    const rec = notes.get(noteId);
    const t = rec?.get('text');
    if (!(t instanceof Y.Text) || rec?.get('deleted') === true) continue;
    const text = t.toString();
    if (text !== last) {
      out.push({ at: s.end, text });
      last = text;
    }
  }
  return out;
}

/** The smallest single edit that turns `from` into `to`: the common start and end are kept. */
export function minimalEdit(from: string, to: string): { index: number; remove: number; insert: string } {
  let start = 0;
  const max = Math.min(from.length, to.length);
  while (start < max && from[start] === to[start]) start++;
  let endFrom = from.length;
  let endTo = to.length;
  while (endFrom > start && endTo > start && from[endFrom - 1] === to[endTo - 1]) {
    endFrom--;
    endTo--;
  }
  return { index: start, remove: endFrom - start, insert: to.slice(start, endTo) };
}
