import type * as Y from 'yjs';
import { APP_NAME, STORAGE_PREFIX } from '../constants';
import { accountDocId, accountLogDocId, CURRENT_ACCOUNT_KEY, LEGACY_ACCOUNT_KEY } from '../core/account';
import type { StorageLike } from '../core/account-setup';
import { docDbName, privateDocId, spaceDocId, spaceLogDocId } from '../core/doc-store';
import { bundleText } from '../backup/restore';
import { reloadOtherTabs } from '../backup/replace';
import { lastBackupAt, saveTextFile } from '../backup/runtime';
import { createSnapshot } from '../backup/snapshot';
import type { SyncService } from '../sync/sync-service';
import { deleteDatabase } from './leave';

/** What the next start erases (set by `resetDevice`). */
const RESET_KEY = `${STORAGE_PREFIX}-reset-device`;

interface PendingReset {
  spaces: string[];
  /** Account id whose document is erased too: a reset of everything. */
  account?: string;
  /** The old id of a moved account, from a reset chosen before #295: its document and log are erased too. */
  legacy?: string;
  clearHistory: boolean;
}

/** The documents a reset of these spaces (and the account document, when given) erases. */
export function resetDocIds(spaces: readonly string[], accountId?: string, legacyId?: string): string[] {
  return [...(accountId ? [accountDocId(accountId), accountLogDocId(accountId)] : []), ...(legacyId ? [accountDocId(legacyId), accountLogDocId(legacyId)] : []), ...spaces.flatMap((id) => [spaceDocId(id), privateDocId(id), spaceLogDocId(id)])];
}

/** A backup has been written on this device before, so a reset can be restored from it. */
export function hasBackup(): boolean {
  return lastBackupAt() !== undefined;
}

/** Download a backup file of everything on this device, taken right before a reset. Returns the file name. */
export async function saveSafetyBackup(docs: ReadonlyMap<string, Y.Doc>, deviceId: string): Promise<string> {
  const snap = await createSnapshot(docs, { deviceId, reason: 'before reset' });
  const fileName = `${APP_NAME.toLowerCase()}-before-reset-${new Date().toISOString().slice(0, 10)}.json`;
  saveTextFile(fileName, bundleText(snap));
  return fileName;
}

/**
 * Throw this device's copy away so it can start again from another device or a backup (docs/sync.md).
 * Databases cannot be deleted while open, so this records what to erase and reloads; the erase runs
 * at the next start (`applyPendingReset`). One or more spaces: the device stays in the account and
 * keeps those spaces, so they refill from a linked device. Everything (`accountId` given): the
 * account document goes too and the sync code is forgotten, so the device rejoins with the code.
 */
export function resetDevice(options: {
  sync: SyncService;
  storage: StorageLike;
  spaces: readonly string[];
  /** Reset everything: also erase this account's document and forget the sync code. */
  accountId?: string;
  clearHistory: boolean;
  /** Reloads the page (replaced in tests). */
  reload?: () => void;
}): void {
  const { sync, storage } = options;
  const pending: PendingReset = {
    spaces: [...options.spaces],
    ...(options.accountId ? { account: options.accountId } : {}),
    clearHistory: options.clearHistory,
  };
  storage.setItem(RESET_KEY, JSON.stringify(pending));
  if (options.accountId) {
    sync.unpair();
    // An empty id makes the next start make a fresh account, which joining the sync code replaces.
    storage.setItem(CURRENT_ACCOUNT_KEY, '');
    storage.setItem(LEGACY_ACCOUNT_KEY, '');
  }
  reloadOtherTabs();
  (options.reload ?? (() => location.reload()))();
}

/**
 * Carry out a reset recorded before the reload. Call at start, before any document is opened.
 * Returns the document ids erased.
 */
export async function applyPendingReset(
  storage: StorageLike,
  io: { remove?: (name: string) => Promise<void>; clearHistory?: (docId: string) => Promise<void> } = {},
): Promise<string[]> {
  let pending: PendingReset | undefined;
  try {
    const parsed = JSON.parse(storage.getItem(RESET_KEY) ?? 'null') as Partial<PendingReset> | null;
    if (parsed && Array.isArray(parsed.spaces)) {
      pending = {
        spaces: parsed.spaces.filter((x): x is string => typeof x === 'string'),
        clearHistory: parsed.clearHistory === true,
        ...(typeof parsed.account === 'string' ? { account: parsed.account } : {}),
        ...(typeof parsed.legacy === 'string' ? { legacy: parsed.legacy } : {}),
      };
    }
  } catch {
    pending = undefined;
  }
  if (!pending) return [];
  storage.setItem(RESET_KEY, 'null');
  const ids = resetDocIds(pending.spaces, pending.account, pending.legacy);
  for (const id of ids) {
    await (io.remove ?? deleteDatabase)(docDbName(id));
    if (pending.clearHistory) await io.clearHistory?.(id);
  }
  return ids;
}
