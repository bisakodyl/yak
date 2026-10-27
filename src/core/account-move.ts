import * as Y from 'yjs';
import { accountDocId, CURRENT_ACCOUNT_KEY, LEGACY_ACCOUNT_KEY, readSpaces } from './account';
import { accountIdOfFingerprint, chooseAccountKey, chosenFingerprint, keysMap, pickAccountKey, publishAccountKey, readAccountKeys, sealAccountKey } from './account-keys';
import { isLeft, isRemoved } from './devices';
import type { StorageLike } from './account-setup';
import { fingerprint, generateAccountKey } from './keys';
import { checkChosen, keysRequired, type PinnedChoice } from './key-certs';

/**
 * Moving an account to its fingerprint id (S-76r, F39, #255). The account key pair gives the
 * account its id; an account made before that moves at the first start of a build with keys: the
 * account document is copied to `account/<fingerprint>` with `Y.applyUpdate`, and the old id is kept
 * under `LEGACY_ACCOUNT_KEY` until the start folds the old documents in and moves the pairing (main.tsx).
 *
 * Several devices may create an account key at the same time. All public keys are published in the
 * account document (`account:<fingerprint>`); every device follows the `chosen` field of the
 * document, written once, so the devices that created a different one switch. Copying one Yjs state
 * on two devices converges.
 */

export interface LocalAccountKeys {
  get(fp: string): Promise<CryptoKey | undefined>;
  save(fp: string, key: CryptoKey): Promise<void>;
  drop(fp: string): Promise<void>;
}

export interface SettleEnv {
  open(docId: string): Promise<Y.Doc>;
  storage: StorageLike;
  keys: LocalAccountKeys;
  me: string;
  /** This device syncs with others (a sync code): older builds may share the account, so the old id stays in use. */
  paired: boolean;
  /** A peer has sent this device the account document since it was updated (a paired device makes no key before). */
  synced?: boolean;
  /** Clock, replaced in tests. */
  now?: () => number;
  /** The account key this device follows, kept outside the document (#256); absent: follow the document as slice 1 did. */
  pin?: ChoicePin;
}

/** Where a device keeps the account key it follows, with the account ids it was pinned under. */
export interface ChoicePin {
  get(): (PinnedChoice & { ids: string[] }) | undefined;
  set(p: PinnedChoice & { ids: string[] }): void;
}

export interface SettleResult {
  /** `unchanged` the account already has the winning id, `moved` this device switched (reload), `waiting` a joining device without data creates no key yet. */
  status: 'unchanged' | 'moved' | 'waiting';
  accountId: string;
  /** The document chose this key and this device refused to follow it (unsigned overwrite, #256). */
  refused?: string;
}

/** The pin that applies to the account this device uses now; a pin from another account (this device joined a different one) does not. */
function pinFor(env: SettleEnv, id: string): PinnedChoice | undefined {
  const p = env.pin?.get();
  if (!p || !p.ids.includes(id)) return undefined;
  const { ids: _ids, ...pin } = p;
  return pin;
}

/** The old id of this device's account, when it has one. */
export function legacyAccountId(storage: StorageLike): string | undefined {
  return storage.getItem(LEGACY_ACCOUNT_KEY) || undefined;
}

/**
 * Make sure the account has a key and this device uses the winning account's id. `id` and `doc`
 * are the account this device uses now. A new key is made at once only by a device that is not
 * paired; a paired one first needs the account document from a peer (it may already have a key, and
 * a device that was offline during the update must follow it, not make its own).
 */
export async function settleAccount(env: SettleEnv, id: string, doc: Y.Doc): Promise<SettleResult> {
  const now = env.now ?? Date.now;
  const pinned = pinFor(env, id);
  let keys = await readAccountKeys(doc);
  // The pinned key's record is gone (deleted by someone with the sync code): put it back from the pin and stay on it.
  if (pinned?.publicKey && !keys.some((k) => k.fingerprint === pinned.fingerprint)) {
    keysMap(doc).set(`account:${pinned.fingerprint}`, { public: pinned.publicKey, by: pinned.by ?? '', at: 0 });
    keys = await readAccountKeys(doc);
  }
  if (keys.length === 0) {
    if (env.paired && (!env.synced || readSpaces(doc).length === 0)) return { status: 'waiting', accountId: id };
    const pair = await generateAccountKey();
    const fp = await fingerprint(pair.publicKey);
    await env.keys.save(fp, pair.privateKey);
    publishAccountKey(doc, fp, pair.publicKey, env.me, now());
    keys = await readAccountKeys(doc);
  }
  // Every device follows the `chosen` key; with none (an account from before this rule) the first device to settle writes one.
  // A change of `chosen` is followed only when it is authorised (#256); otherwise the pinned key stays.
  const check = env.pin ? await checkChosen(doc, chosenFingerprint(doc), pinned) : { fingerprint: chosenFingerprint(doc) };
  const refused = 'refused' in check && check.refused ? { refused: check.refused } : {};
  let winner = chooseAccountKey(keys, check.fingerprint);
  if (!winner) {
    // A pinned device never picks another key: without its record (and no copy in the pin, an older pin) it stays where it is.
    if (pinned) return { status: 'unchanged', accountId: id, ...refused };
    winner = pickAccountKey(keys) as (typeof keys)[number];
    keysMap(doc).set('chosen', winner.fingerprint);
  }
  const winnerId = accountIdOfFingerprint(winner.fingerprint);
  if (env.pin) {
    const before = env.pin.get();
    const ids = [...new Set([...(before && before.ids.includes(id) ? before.ids : []), id, winnerId])];
    env.pin.set({
      fingerprint: winner.fingerprint,
      sealed: (pinned?.fingerprint === winner.fingerprint && pinned.sealed) || winner.sealed,
      publicKey: winner.publicKey,
      by: pinned?.fingerprint === winner.fingerprint && pinned.by !== undefined ? pinned.by : winner.by,
      ids,
    });
  }
  // A key this device made that does not win is of no use: no private key lingers.
  for (const k of keys) if (k.by === env.me && k.fingerprint !== winner.fingerprint) await env.keys.drop(k.fingerprint);
  // A keys-required account keeps its id when its key changes (S-76s): only an account from before the keys moves.
  if (winnerId === id || (await keysRequired(doc, winner.fingerprint, keys))) return { status: 'unchanged', accountId: id, ...refused };

  // Copy the state; the next start folds anything left in the old document in and stops using its id.
  const target = await env.open(accountDocId(winnerId));
  Y.applyUpdate(target, Y.encodeStateAsUpdate(doc));
  if (env.paired && !legacyAccountId(env.storage)) env.storage.setItem(LEGACY_ACCOUNT_KEY, id);
  env.storage.setItem(CURRENT_ACCOUNT_KEY, winnerId);
  return { status: 'moved', accountId: winnerId, ...refused };
}

/**
 * The passphrase was just typed on this device. Seal the account key if this device holds it. If the
 * account's key is unsealed and nobody can seal it any more (its creator was removed or left), make a new key, seal it and make it the chosen one (S-76s). Returns what happened.
 */
export async function sealAccount(env: SettleEnv, doc: Y.Doc, passphrase: string, iterations?: number): Promise<'sealed' | 'replaced' | 'none'> {
  const now = env.now ?? Date.now;
  const pin = env.pin?.get();
  const followed = pin && chooseAccountKey(await readAccountKeys(doc), pin.fingerprint) ? pin.fingerprint : chosenFingerprint(doc);
  const win = chooseAccountKey(await readAccountKeys(doc), followed);
  if (!win || win.sealed) return 'none';
  const mine = await env.keys.get(win.fingerprint);
  if (mine) {
    await sealAccountKey(doc, win.fingerprint, mine, passphrase, iterations);
    await env.keys.drop(win.fingerprint);
    if (env.pin && pin?.fingerprint === win.fingerprint) env.pin.set({ ...pin, sealed: true });
    return 'sealed';
  }
  // Only a removed or left creator: other devices could not check a claim that it lost its key (S-76s, #256).
  const gone = isRemoved(doc, win.by) || isLeft(doc, win.by);
  if (!gone) return 'none';
  const pair = await generateAccountKey();
  const fp = await fingerprint(pair.publicKey);
  await sealAccountKey(doc, fp, pair.privateKey, passphrase, iterations);
  doc.transact(() => {
    publishAccountKey(doc, fp, pair.publicKey, env.me, now());
    // Only an unsealed choice is replaced (checked above), and only by a sealed key.
    keysMap(doc).set('chosen', fp);
  });
  // This device made the replacement under the rule itself: follow it (others check it with `checkChosen`).
  if (env.pin && pin) env.pin.set({ fingerprint: fp, sealed: true, publicKey: pair.publicKey, by: env.me, ids: [...new Set([...pin.ids, accountIdOfFingerprint(fp)])] });
  return 'replaced';
}
