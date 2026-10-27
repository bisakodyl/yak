import * as Y from 'yjs';
import type { CollectionName } from './schema';

/**
 * Concurrent edits of one field. Two devices set the same field of a record before either saw the
 * other's edit; Yjs keeps one value everywhere and the other is gone from view. On the device whose
 * value lost, `watchConflicts` reports it so the person can keep their own value instead.
 */
export interface FieldConflict {
  collection: CollectionName;
  recordId: string;
  field: string;
  /** The value this device had (now replaced). */
  mine: unknown;
  /** The value that won. */
  theirs: unknown;
  /** Unique per losing edit: the winning item's id. */
  id: string;
  /** Description, name or path of the record, for display. */
  label: string;
}

/** Fields that follow from other fields or only record when something changed. */
const IGNORED = new Set(['updated_at', 'deleted_at', 'duration']);
const MAX_PER_TRANSACTION = 10;

interface ItemLike {
  id: { client: number; clock: number };
  lastId: { client: number; clock: number };
  origin: { client: number; clock: number } | null;
  left: ItemLike | null;
}

function same(a: { client: number; clock: number }, b: { client: number; clock: number }): boolean {
  return a.client === b.client && a.clock === b.clock;
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Is the value that replaced `old` a concurrent edit, not a later edit made with `old` in view? */
function wasConcurrent(target: Y.Map<unknown>, key: string, tr: Y.Transaction): boolean {
  const map = (target as unknown as { _map: Map<string, ItemLike> })._map;
  let item = map.get(key);
  if (!item) return false;
  const existed = (i: ItemLike): boolean => i.id.clock < (tr.beforeState.get(i.id.client) ?? 0);
  // The oldest of the items this transaction brought in for the key.
  while (item.left && !existed(item.left)) item = item.left;
  const prev = item.left;
  if (!prev) return false;
  return !item.origin || !same(item.origin, prev.lastId);
}

/**
 * Calls `report` for every field of `collection` in `doc` whose value was replaced by a concurrent
 * edit that arrived from elsewhere. Returns the stop function.
 */
export function watchConflicts(doc: Y.Doc, collection: CollectionName, report: (c: FieldConflict) => void): () => void {
  const root = doc.getMap<Y.Map<unknown>>(collection);
  const handler = (events: Y.YEvent<Y.AbstractType<unknown>>[], tr: Y.Transaction): void => {
    if (tr.local) return;
    let count = 0;
    for (const ev of events) {
      const target = ev.target;
      if (!(target instanceof Y.Map) || ev.path.length !== 1 || target.parent !== root) continue;
      const recordId = String(ev.path[0]);
      for (const [field, change] of ev.keys) {
        if (count >= MAX_PER_TRANSACTION) return;
        if (change.action !== 'update' || IGNORED.has(field)) continue;
        const mine = change.oldValue as unknown;
        const theirs = target.get(field);
        if (mine instanceof Y.AbstractType || theirs instanceof Y.AbstractType || equal(mine, theirs)) continue;
        if (!wasConcurrent(target, field, tr)) continue;
        const item = (target as unknown as { _map: Map<string, ItemLike> })._map.get(field) as ItemLike;
        const label = ['description', 'name', 'path'].map((k) => target.get(k)).find((v) => typeof v === 'string' && v !== '');
        report({ collection, recordId, field, mine, theirs, id: `${item.id.client}:${item.id.clock}`, label: typeof label === 'string' ? label : '' });
        count++;
      }
    }
  };
  root.observeDeep(handler);
  return () => root.unobserveDeep(handler);
}

/** Set `mine` again if the winning value is still in place. Returns false when the field has changed since. */
export function keepMine(doc: Y.Doc, c: Pick<FieldConflict, 'collection' | 'recordId' | 'field' | 'mine' | 'theirs'>): boolean {
  const record = doc.getMap<Y.Map<unknown>>(c.collection).get(c.recordId);
  if (!record || !equal(record.get(c.field), c.theirs)) return false;
  doc.transact(() => {
    record.set(c.field, c.mine);
    if (record.has('updated_at')) record.set('updated_at', new Date().toISOString());
  });
  return true;
}
