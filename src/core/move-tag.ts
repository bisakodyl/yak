import type * as Y from 'yjs';
import type { BulkTx } from './bulk';
import { setTagHidden } from './hidden-tags';
import { createRecord, liveRecords, nowIso, type Tag } from './schema';

/**
 * Move a tag to another space (owner, 2026-10-19): hidden from pickers in the source, created in the
 * destination. Entries and notes keep their tag names. `as` makes it under another name when the
 * destination's tag of the same name should stay apart. Returns the name now in the destination.
 */
export function moveTag(from: Y.Doc, to: Y.Doc, name: string, as?: string, tx: BulkTx = (doc, change) => doc.transact(change)): string {
  const target = (as ?? name).trim() || name.trim();
  const has = liveRecords<Tag>(to, 'tags').some((t) => t.name.toLowerCase() === target.toLowerCase());
  tx(to, () => {
    if (!has) createRecord(to, 'tags', { name: target, created_at: nowIso(), deleted: false });
    setTagHidden(to, target, false);
  });
  tx(from, () => setTagHidden(from, name, true));
  return target;
}

/** Whether the destination already has a tag of this name (a record or a hidden flag). */
export function tagExists(to: Y.Doc, name: string): boolean {
  const lower = name.trim().toLowerCase();
  return liveRecords<Tag>(to, 'tags').some((t) => t.name.toLowerCase() === lower);
}
