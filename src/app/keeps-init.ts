import { STORAGE_PREFIX } from '../constants';
import { readSpaces } from '../core/account';
import { keepAll } from '../core/keeps';
import type { StorageLike } from '../core/account-setup';
import type * as Y from 'yjs';

/** Device-local flag: this device already wrote its `keeps` entries into the account document. */
export const KEEPS_FLAG = `${STORAGE_PREFIX}-keeps-v1`;

export interface LegacyChoices {
  /** Devices met with this device's pairing. */
  peers: readonly string[];
  /** The first layout's per-pair choices: for a peer, the only spaces this device synced with it. */
  peerSpaces?: Readonly<Record<string, readonly string[]>> | undefined;
}

/**
 * The first time a device starts with per-device spaces, it keeps the spaces of its account, and
 * the devices it already syncs with keep what the per-pair choices let them have (everything, unless
 * a list was set). After that, `keeps` only changes by choice, and a device that joins later keeps
 * nothing until its spaces are chosen. Returns whether anything was written.
 */
export function initKeeps(account: Y.Doc, me: string, storage: StorageLike, legacy?: LegacyChoices): boolean {
  if (storage.getItem(KEEPS_FLAG)) return false;
  const spaceIds = readSpaces(account).map((s) => s.id);
  keepAll(account, me, spaceIds);
  for (const peer of legacy?.peers ?? []) {
    const list = legacy?.peerSpaces?.[peer];
    keepAll(account, peer, list ? spaceIds.filter((id) => list.includes(id)) : spaceIds);
  }
  storage.setItem(KEEPS_FLAG, new Date().toISOString());
  return true;
}
