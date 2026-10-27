import type * as Y from 'yjs';
import { type EncryptionParams, keyFor, readFolderEncryption, withKey, EncryptedError } from './crypto';
import type { BackupDir } from './dir';
import { kvGet, kvSet } from './device-db';

import { readAccountEncryption, writeAccountEncryption } from '../core/account-encryption';

export { readAccountEncryption, writeAccountEncryption };

const KEY = 'encryption-key';


interface StoredKey {
  accountId: string;
  params: EncryptionParams;
  key: CryptoKey;
}

/** The key lives on this device only, as a non-extractable CryptoKey in IndexedDB. */
export async function saveDeviceKey(accountId: string, params: EncryptionParams, key: CryptoKey): Promise<void> {
  await kvSet(KEY, { accountId, params, key } satisfies StoredKey);
}

/** The account moved to its fingerprint id (#255): this device's key follows it. */
export async function moveDeviceKey(from: string, to: string): Promise<void> {
  const stored = await kvGet<StoredKey>(KEY).catch(() => undefined);
  if (stored && stored.accountId === from) await kvSet(KEY, { ...stored, accountId: to } satisfies StoredKey);
}

export async function clearDeviceKey(): Promise<void> {
  await kvSet(KEY, undefined);
}

/** This device's key, if it belongs to the account and matches the account's current passphrase. */
export async function deviceKey(accountId: string, account?: Y.Doc): Promise<{ key: CryptoKey; params: EncryptionParams } | undefined> {
  const stored = await kvGet<StoredKey>(KEY).catch(() => undefined);
  if (!stored || stored.accountId !== accountId) return undefined;
  const current = account ? readAccountEncryption(account) : undefined;
  if (account && (!current || current.salt !== stored.params.salt || current.check !== stored.params.check)) return undefined;
  return { key: stored.key, params: stored.params };
}

/**
 * The folder read through the account's key when its backups are encrypted: this device's key,
 * else the passphrase typed for a restore. Plain folders come back unchanged; encrypted ones with
 * neither key nor passphrase fail with `EncryptedError`.
 */
export async function readableFolder(root: BackupDir, accountFolder: string, accountId: string | undefined, passphrase: string): Promise<BackupDir> {
  const params = await readFolderEncryption(root, accountFolder);
  if (!params) return root;
  const mine = accountId === accountFolder ? await deviceKey(accountId) : undefined;
  if (mine && mine.params.salt === params.salt && mine.params.check === params.check) return withKey(root, mine.key);
  if (!passphrase) throw new EncryptedError();
  return withKey(root, await keyFor(passphrase, params));
}
