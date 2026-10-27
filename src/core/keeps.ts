import type * as Y from 'yjs';

/**
 * Which spaces each device of the account keeps, in the account document's `keeps` map
 * (docs/sync.md). A device keeps a space only when the document says so: a device
 * that has just joined keeps nothing until its spaces are chosen, so no space reaches it before the
 * owner decides. A space syncs between two devices only if both keep it.
 *
 * Keys are `<deviceId>:<spaceId>` with plain boolean values, so two devices setting different
 * entries at once never lose each other's change.
 *
 * Keeping is a choice, not a lock: every device of the account holds the sync code and can edit this
 * map. Until per-device keys exist (docs/sync.md, "Trust limit") it only governs
 * what honest devices send and accept.
 */

const KEEPS_MAP = 'keeps';

export function keepsMap(doc: Y.Doc): Y.Map<boolean> {
  return doc.getMap<boolean>(KEEPS_MAP);
}

export function keeps(doc: Y.Doc, deviceId: string, spaceId: string): boolean {
  return keepsMap(doc).get(`${deviceId}:${spaceId}`) === true;
}

/** The device has made a choice (yes or no) about this space; a space it has not decided on is not kept. */
export function decided(doc: Y.Doc, deviceId: string, spaceId: string): boolean {
  return keepsMap(doc).has(`${deviceId}:${spaceId}`);
}

export function setKeeps(doc: Y.Doc, deviceId: string, spaceId: string, on: boolean): void {
  keepsMap(doc).set(`${deviceId}:${spaceId}`, on);
}

/** The ids among `spaceIds` that the device keeps. */
export function keptSpaces(doc: Y.Doc, deviceId: string, spaceIds: Iterable<string>): string[] {
  return [...spaceIds].filter((id) => keeps(doc, deviceId, id));
}

/** Make a device keep each of these spaces, in one transaction. */
export function keepAll(doc: Y.Doc, deviceId: string, spaceIds: Iterable<string>): void {
  const ids = [...spaceIds];
  doc.transact(() => {
    for (const id of ids) setKeeps(doc, deviceId, id, true);
  });
}

/** Keep the spaces the device has not decided on yet; spaces it said no to stay as they are. */
export function keepUndecided(doc: Y.Doc, deviceId: string, spaceIds: Iterable<string>): void {
  const ids = [...spaceIds].filter((id) => !decided(doc, deviceId, id));
  keepAll(doc, deviceId, ids);
}

/** Say no to the spaces the device has not decided on yet; it is decided afterwards, so the notice drops them. */
export function declineUndecided(doc: Y.Doc, deviceId: string, spaceIds: Iterable<string>): void {
  const ids = [...spaceIds].filter((id) => !decided(doc, deviceId, id));
  doc.transact(() => {
    for (const id of ids) setKeeps(doc, deviceId, id, false);
  });
}

/** Whether the device has any entry at all (it has chosen before, even if it chose nothing). */
export function hasChosen(doc: Y.Doc, deviceId: string): boolean {
  for (const key of keepsMap(doc).keys()) if (key.startsWith(`${deviceId}:`)) return true;
  return false;
}
