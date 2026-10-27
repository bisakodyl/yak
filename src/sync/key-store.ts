import { STORAGE_PREFIX } from '../constants';
import { kvDb, type KvDb } from '../core/kv-db';
import { generateDeviceKeys, type DeviceKeyPairs } from '../core/keys';

/**
 * This device's keys, in IndexedDB beside (never inside) the documents. The device pairs are
 * non-extractable CryptoKeys: scripts on the page can use them but cannot read them out (S-76c).
 * The account private key is kept here only until the passphrase seals it into the account
 * document; the device that created it is the one that holds it.
 */

const DEVICE_KEYS = 'device-keys';
const accountKeyName = (fp: string): string => `account-key:${fp}`;

let db: KvDb | undefined;
const store = (): KvDb => (db ??= kvDb(`${STORAGE_PREFIX}-keys`));

/** This device's key pairs; made on first use. Null when the browser has no IndexedDB or WebCrypto (the feature is skipped). */
export async function ownDeviceKeys(kv: Pick<KvDb, 'kvGet' | 'kvSet'> = store()): Promise<DeviceKeyPairs | null> {
  try {
    const have = await kv.kvGet<DeviceKeyPairs>(DEVICE_KEYS);
    if (have?.sign && have.agree && have.publicKeys) return have;
    const made = await generateDeviceKeys();
    await kv.kvSet(DEVICE_KEYS, made);
    return made;
  } catch {
    return null;
  }
}

/** Forget this device's key pairs (it leaves the account, #258): the next use makes new ones, which need a new approval. */
export async function dropOwnDeviceKeys(kv: Pick<KvDb, 'kvSet'> = store()): Promise<void> {
  await kv.kvSet(DEVICE_KEYS, undefined).catch(() => undefined);
}

export async function localAccountKey(fp: string, kv: Pick<KvDb, 'kvGet'> = store()): Promise<CryptoKey | undefined> {
  return kv.kvGet<CryptoKey>(accountKeyName(fp)).catch(() => undefined);
}

export async function saveLocalAccountKey(fp: string, key: CryptoKey, kv: Pick<KvDb, 'kvSet'> = store()): Promise<void> {
  await kv.kvSet(accountKeyName(fp), key);
}

export async function dropLocalAccountKey(fp: string, kv: Pick<KvDb, 'kvSet'> = store()): Promise<void> {
  await kv.kvSet(accountKeyName(fp), undefined).catch(() => undefined);
}
