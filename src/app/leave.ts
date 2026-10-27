import type * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { setLeft } from '../core/devices';
import { docDbName, privateDocId, spaceDocId, spaceLogDocId } from '../core/doc-store';
import { setKeeps } from '../core/keeps';
import type { StorageLike } from '../core/account-setup';
import type { SyncService } from '../sync/sync-service';

/** Spaces whose local copy is erased at the next start (set by `leaveAccount`). */
const ERASE_KEY = `${STORAGE_PREFIX}-erase-spaces`;

/**
 * This device leaves the account (docs/sync.md). It marks
 * itself `left`, so the other devices stop listing it, and stops keeping the spaces it erases; waits a
 * moment so linked devices receive that; then forgets the sync code, and with keys required its device keys
 * (`dropKeys`, #258): coming back takes new keys and a new approval. Its data stays unless `erase`
 * names spaces: those local copies are deleted when the page reloads (databases cannot be deleted
 * while open). The other devices keep syncing with each other.
 */
export async function leaveAccount(options: {
  sync: SyncService;
  account: Y.Doc;
  me: string;
  erase: readonly string[];
  storage: StorageLike;
  /** Reloads the page (replaced in tests). */
  reload?: () => void;
  /** Deletes this device's private keys: passed when the account requires keys. */
  dropKeys?: () => Promise<void>;
}): Promise<void> {
  const { sync, account, me, erase, storage } = options;
  account.transact(() => {
    setLeft(account, me, true);
    for (const id of erase) setKeeps(account, me, id, false);
  });
  if (sync.status.peers.some((p) => p.state === 'connected')) await new Promise((r) => setTimeout(r, 1500));
  sync.unpair();
  await options.dropKeys?.().catch(() => undefined);
  if (erase.length > 0) {
    scheduleErase(storage, erase);
    (options.reload ?? (() => location.reload()))();
  }
}

/**
 * Keys required: this device joins the account again with a one-time code (S-258g, #295), for
 * example after it was removed or stopped finding its other devices. It stops syncing and forgets its
 * device keys, so the next request carries new ones; unlike leaving, it is not marked `left` and
 * keeps all its data, which merges back once a device approves it.
 */
export async function rejoinAccount(options: { sync: SyncService; dropKeys: () => Promise<void> }): Promise<void> {
  options.sync.unpair();
  await options.dropKeys().catch(() => undefined);
}

/** Record spaces whose local copies the next start erases. */
export function scheduleErase(storage: StorageLike, ids: readonly string[]): void {
  storage.setItem(ERASE_KEY, JSON.stringify(ids));
}

export function deleteDatabase(name: string, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const done = (): void => {
      clearTimeout(timer);
      resolve();
    };
    try {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = done;
      request.onerror = done;
      request.onblocked = () => undefined;
    } catch {
      done();
    }
  });
}

/**
 * Delete the local copies named by `leaveAccount`. Call at start, before any document is opened.
 * Returns the space ids erased.
 */
export async function applyPendingErase(storage: StorageLike, remove: (name: string) => Promise<void> = deleteDatabase): Promise<string[]> {
  let ids: string[] = [];
  try {
    const parsed: unknown = JSON.parse(storage.getItem(ERASE_KEY) ?? '[]');
    if (Array.isArray(parsed)) ids = parsed.filter((x): x is string => typeof x === 'string');
  } catch {
    ids = [];
  }
  if (ids.length === 0) return [];
  storage.setItem(ERASE_KEY, '[]');
  for (const id of ids) {
    await remove(docDbName(spaceDocId(id)));
    await remove(docDbName(privateDocId(id)));
    await remove(docDbName(spaceLogDocId(id)));
  }
  return ids;
}
