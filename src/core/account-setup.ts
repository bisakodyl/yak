import type * as Y from 'yjs';
import { accountDocId, addSpace, CURRENT_ACCOUNT_KEY, derivedId, initAccountDoc, randomId, readSpaces } from './account';
import type { DocumentStore } from './doc-store';
import { collection } from './schema';
import { ACCOUNT_ID_INFO } from './protocol-ids';

/**
 * Setting up the account on this device (docs/sync.md), once per start and before sync starts:
 * the account id is derived from the sync code when this device is already paired and has none yet,
 * so the devices of one account agree without talking; random otherwise.
 */

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PreparedAccount {
  id: string;
  doc: Y.Doc;
  /** The id was derived from the sync code on this start (a paired device with no account yet). */
  derived: boolean;
}

export function hasData(doc: Y.Doc): boolean {
  for (const name of ['time_entries', 'projects', 'clients', 'tags', 'notes'] as const) if (collection(doc, name).size > 0) return true;
  return doc.getText('t').length > 0;
}

/** Derive the account id from a sync code (normalized secret). */
export function accountIdFromSecret(secret: string): Promise<string> {
  return derivedId(ACCOUNT_ID_INFO, secret);
}

/** Makes the key of a brand-new account (S-76a): its id is the key's fingerprint, and `publish` records it in the account document. */
export type NewAccountKey = () => Promise<{ accountId: string; publish(doc: Y.Doc): void }>;

export async function prepareAccount(store: DocumentStore, options: { pairedSecret?: string; storage: StorageLike; newKey?: NewAccountKey }): Promise<PreparedAccount> {
  const { storage } = options;
  let id = storage.getItem(CURRENT_ACCOUNT_KEY);
  let derived = false;
  let publish: ((doc: Y.Doc) => void) | undefined;
  if (!id) {
    derived = options.pairedSecret !== undefined;
    if (options.pairedSecret) id = await accountIdFromSecret(options.pairedSecret);
    else if (options.newKey) {
      const made = await options.newKey();
      id = made.accountId;
      publish = made.publish;
    } else id = randomId();
    storage.setItem(CURRENT_ACCOUNT_KEY, id);
  }
  const doc = await store.open(accountDocId(id));
  initAccountDoc(doc, id);
  publish?.(doc);
  return { id, doc, derived };
}

/** A new account starts with the two usual spaces, with random ids; the device that makes them keeps them. */
export function ensureDefaultSpaces(account: Y.Doc, makeId: () => string = randomId, keptBy?: string): void {
  if (readSpaces(account).length > 0) return;
  addSpace(account, makeId(), 'Personal', undefined, keptBy);
  addSpace(account, makeId(), 'Work', new Date(Date.now() + 1).toISOString(), keptBy);
}
