import * as Y from 'yjs';

/**
 * Shared types of the Phase 0 proof-of-concept document: a text box, a per-device counter
 * (a grow-only counter, so concurrent increments never overwrite each other) and a map of
 * soft-deletable items (maps keyed by id, so devices can edit different fields of one record).
 */

export function getText(doc: Y.Doc): Y.Text {
  return doc.getText('text');
}

function getCounters(doc: Y.Doc): Y.Map<number> {
  return doc.getMap<number>('counters');
}

export function getItems(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('items');
}

/** Each device writes only its own key, so increments from different devices always add up. */
export function incrementCounter(doc: Y.Doc, deviceId: string, by = 1): void {
  const counters = getCounters(doc);
  doc.transact(() => {
    counters.set(deviceId, (counters.get(deviceId) ?? 0) + by);
  });
}

export function counterTotal(doc: Y.Doc): number {
  let total = 0;
  getCounters(doc).forEach((n) => {
    total += n;
  });
  return total;
}

/**
 * Create a record under a fresh id. Creation must be explicit and use an id no other device
 * can create: if two devices concurrently set the same key of a Y.Map, one nested record wins
 * whole and the other's fields (including a `deleted` flag) are lost. Fresh UUIDs avoid this.
 */
export function createItem(doc: Y.Doc, id: string, fields: Record<string, unknown> = {}): void {
  const items = getItems(doc);
  if (items.has(id)) throw new Error(`Item already exists: ${id}`);
  doc.transact(() => {
    const item = new Y.Map<unknown>();
    for (const [k, v] of Object.entries(fields)) item.set(k, v);
    items.set(id, item);
  });
}

/**
 * Edit one field of an existing record. Returns false, changing nothing, when this device
 * does not have the record: never create a record implicitly (see createItem).
 */
export function setItemField(doc: Y.Doc, id: string, field: string, value: unknown): boolean {
  const item = getItems(doc).get(id);
  if (!item) return false;
  doc.transact(() => {
    item.set(field, value);
  });
  return true;
}

/** Deletes are soft and permanent: the flag is set, never cleared. */
export function softDeleteItem(doc: Y.Doc, id: string): boolean {
  return setItemField(doc, id, 'deleted', true);
}

/** Plain-object snapshot, used by tests to compare documents. */
export function snapshot(doc: Y.Doc): { text: string; counters: Record<string, number>; items: unknown } {
  return {
    text: getText(doc).toString(),
    counters: getCounters(doc).toJSON(),
    items: getItems(doc).toJSON(),
  };
}
