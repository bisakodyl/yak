import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { accountDocId, addSpace, CURRENT_ACCOUNT_KEY } from './account';
import { chosenFingerprint, keysMap, publishAccountKey, sealAccountKey } from './account-keys';
import { sealAccount, settleAccount, type ChoicePin, type SettleEnv } from './account-move';
import { certifyDevice, checkChosen, keysRequired, markKeysRequired, readCerts } from './key-certs';
import { setLeft, setRemoved } from './devices';
import { fingerprint, generateAccountKey, generateDeviceKeys } from './keys';

async function accountKey(doc: Y.Doc, by: string) {
  const k = await generateAccountKey();
  const fp = await fingerprint(k.publicKey);
  publishAccountKey(doc, fp, k.publicKey, by, 0);
  return { ...k, fp };
}

/** Write `chosen` as a device that saw the current value does (an overwrite, not a first write). */
const overwrite = (doc: Y.Doc, fp: string) => keysMap(doc).set('chosen', fp);

describe('device certificates', () => {
  it('counts a certificate only when the chosen account key signed it, for a device still in the account', async () => {
    const doc = new Y.Doc();
    const a = await accountKey(doc, 'devA');
    const other = await generateAccountKey();
    const d1 = await generateDeviceKeys();
    const d2 = await generateDeviceKeys();
    await certifyDevice(doc, a.fp, a.privateKey, 'dev1', d1.publicKeys);
    // Signed by a key that is not the account's, but claiming to be.
    await certifyDevice(doc, a.fp, other.privateKey, 'dev2', d2.publicKeys);
    // A copied certificate under another device id does not verify.
    keysMap(doc).set('cert:dev3', keysMap(doc).get('cert:dev1'));
    expect([...(await readCerts(doc, a.fp)).keys()]).toEqual(['dev1']);
    expect((await readCerts(doc, undefined)).size).toBe(0);
    setRemoved(doc, 'dev1', true);
    expect((await readCerts(doc, a.fp)).size).toBe(0);
  });

  it('keys required: only the account key can say so', async () => {
    const doc = new Y.Doc();
    const a = await accountKey(doc, 'devA');
    expect(await keysRequired(doc, a.fp)).toBe(false);
    const other = await generateAccountKey();
    await markKeysRequired(doc, a.fp, other.privateKey);
    expect(await keysRequired(doc, a.fp)).toBe(false);
    keysMap(doc).set('required', { account: a.fp });
    expect(await keysRequired(doc, a.fp)).toBe(false);
    await markKeysRequired(doc, a.fp, a.privateKey);
    expect(await keysRequired(doc, a.fp)).toBe(true);
    expect(await keysRequired(doc, 'f'.repeat(32))).toBe(false);
  });
});

describe('a change of keys.chosen on receive (#256)', () => {
  it('ignores an unsigned overwrite while the creator is still in the account', async () => {
    const doc = new Y.Doc();
    const a = await accountKey(doc, 'devA');
    const evil = await accountKey(doc, 'devEvil');
    overwrite(doc, evil.fp);
    const r = await checkChosen(doc, chosenFingerprint(doc), { fingerprint: a.fp, sealed: false });
    expect(r).toEqual({ fingerprint: a.fp, refused: evil.fp });
  });

  it('ignores a replacement that claims to come from the same creator', async () => {
    const doc = new Y.Doc();
    const a = await accountKey(doc, 'devA');
    const again = await accountKey(doc, 'devA');
    await sealAccountKey(doc, again.fp, again.privateKey, 'correct horse battery', 100_000);
    overwrite(doc, again.fp);
    expect((await checkChosen(doc, again.fp, { fingerprint: a.fp, sealed: false })).refused).toBe(again.fp);
  });

  it('follows a replacement once the creator of the unsealed key was removed or left', async () => {
    for (const mark of [(d: Y.Doc) => setRemoved(d, 'devA', true), (d: Y.Doc) => setLeft(d, 'devA', true)]) {
      const doc = new Y.Doc();
      const a = await accountKey(doc, 'devA');
      const b = await accountKey(doc, 'devB');
      overwrite(doc, b.fp);
      mark(doc);
      expect(await checkChosen(doc, b.fp, { fingerprint: a.fp, sealed: false })).toEqual({ fingerprint: b.fp, accepted: 'creator gone' });
    }
  });

  it('never replaces a key once seen sealed, even if the seal is deleted, the creator marked removed, and an old build left a handover record', async () => {
    const doc = new Y.Doc();
    const a = await accountKey(doc, 'devA');
    const b = await accountKey(doc, 'devB');
    overwrite(doc, b.fp);
    setRemoved(doc, 'devA', true);
    keysMap(doc).set(`handover:${b.fp}`, { from: a.fp, sig: 'AAAA' });
    expect((await checkChosen(doc, b.fp, { fingerprint: a.fp, sealed: true })).refused).toBe(b.fp);
  });
});

class Device {
  readonly storage = new Map<string, string>();
  readonly local = new Map<string, CryptoKey>();
  readonly docs = new Map<string, Y.Doc>();
  pinned: ReturnType<ChoicePin['get']>;
  clock = Date.now();
  paired = false;
  constructor(readonly me: string) {
    this.storage.set(CURRENT_ACCOUNT_KEY, 'a'.repeat(24));
  }
  open = async (id: string) => this.docs.get(id) ?? this.docs.set(id, new Y.Doc()).get(id)!;
  env(): SettleEnv {
    return {
      open: this.open,
      storage: { getItem: (k) => this.storage.get(k) ?? null, setItem: (k, v) => void this.storage.set(k, v) },
      keys: { get: async (fp) => this.local.get(fp), save: async (fp, k) => void this.local.set(fp, k), drop: async (fp) => void this.local.delete(fp) },
      me: this.me,
      paired: this.paired,
      synced: true,
      now: () => this.clock,
      pin: { get: () => this.pinned, set: (p) => void (this.pinned = p) },
    };
  }
  get id() {
    return this.storage.get(CURRENT_ACCOUNT_KEY) as string;
  }
  async start() {
    return settleAccount(this.env(), this.id, await this.open(accountDocId(this.id)));
  }
}

describe('settling with a pinned key', () => {
  it('stays on the pinned key when its record is deleted and a sealed key is chosen instead', async () => {
    const d = new Device('devA');
    addSpace(await d.open(accountDocId(d.id)), 'p1', 'Personal');
    await d.start();
    const home = d.id;
    const pinnedFp = d.pinned!.fingerprint;
    const doc = await d.open(accountDocId(home));
    keysMap(doc).delete(`account:${pinnedFp}`);
    const evil = await accountKey(doc, 'devEvil');
    await sealAccountKey(doc, evil.fp, evil.privateKey, 'correct horse battery', 100_000);
    // A low fingerprint too would not help: nothing is picked while a pin exists.
    overwrite(doc, evil.fp);
    const r = await d.start();
    expect(r).toMatchObject({ status: 'unchanged', accountId: home, refused: evil.fp });
    expect(d.pinned!.fingerprint).toBe(pinnedFp);
    // The pinned key is published again.
    expect((await import('./account-keys').then((m) => m.readAccountKeys(doc))).some((k) => k.fingerprint === pinnedFp)).toBe(true);
  });

  it('a device does not move when someone with the sync code overwrites chosen', async () => {
    const d = new Device('devA');
    addSpace(await d.open(accountDocId(d.id)), 'p1', 'Personal');
    expect((await d.start()).status).toBe('moved');
    const home = d.id;
    expect((await d.start()).status).toBe('unchanged');
    const doc = await d.open(accountDocId(home));
    const evil = await accountKey(doc, 'devEvil');
    overwrite(doc, evil.fp);
    const r = await d.start();
    expect(r).toMatchObject({ status: 'unchanged', accountId: home, refused: evil.fp });
    expect(d.id).toBe(home);
  });

  it('sealAccount no longer replaces a key whose creator is this device', async () => {
    const d = new Device('devA');
    addSpace(await d.open(accountDocId(d.id)), 'p1', 'Personal');
    await d.start();
    // This browser lost its stored key.
    d.local.clear();
    const doc = await d.open(accountDocId(d.id));
    expect(await sealAccount(d.env(), doc, 'correct horse battery', 100_000)).toBe('none');
    setRemoved(doc, 'devA', true);
    expect(await sealAccount(d.env(), doc, 'correct horse battery', 100_000)).toBe('replaced');
    // The device made the replacement itself, so it follows it.
    expect((await d.start()).status).toBe('moved');
  });
});

describe('older builds and a rollback (#256)', () => {
  it('slice 1 reads the same keys and settles the same way with every new record in the document', async () => {
    const d = new Device('devA');
    addSpace(await d.open(accountDocId(d.id)), 'p1', 'Personal');
    await d.start();
    const doc = await d.open(accountDocId(d.id));
    const { readAccountKeys, readDeviceKeys, publishDeviceKeys } = await import('./account-keys');
    const dev = await generateDeviceKeys();
    publishDeviceKeys(doc, 'devA', dev.publicKeys);
    const beforeKeys = (await readAccountKeys(doc)).map((k) => k.fingerprint);
    const fp = beforeKeys[0] as string;
    const key = d.local.get(fp) as CryptoKey;
    await certifyDevice(doc, fp, key, 'devA', dev.publicKeys);
    await markKeysRequired(doc, fp, key);
    keysMap(doc).set(`handover:${'f'.repeat(32)}`, { from: fp, sig: 'AAAA' });
    keysMap(doc).set(`grant:p1:1:devA`, { kid: 'x', wrapped: 'y', by: 'devA', sig: 'z' });
    expect((await readAccountKeys(doc)).map((k) => k.fingerprint)).toEqual(beforeKeys);
    expect([...readDeviceKeys(doc).keys()]).toEqual(['devA']);
    // Slice 1 settles without a pin, as before.
    const { pin: _pin, ...slice1 } = d.env();
    expect((await settleAccount(slice1, d.id, doc)).status).toBe('unchanged');
  });
});
