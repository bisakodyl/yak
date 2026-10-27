import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { accountDocId, addSpace, CURRENT_ACCOUNT_KEY, LEGACY_ACCOUNT_KEY as LEGACY_KEY, readSpaces } from './account';
import { accountIdOfFingerprint, chooseAccountKey, pickAccountKey, publishAccountKey, publishDeviceKeys, readAccountKeys, readDeviceKeys, unsealAccountKey, isSealed, winningAccountKey } from './account-keys';
import { setRemoved } from './devices';
import { sealAccount, settleAccount, type LocalAccountKeys, type SettleEnv } from './account-move';
import { fingerprint, generateAccountKey, generateDeviceKeys } from './keys';
import { decryptBytes, WrongPassphraseError } from './crypto';
import { keyFor, newEncryption } from '../backup/crypto';
import { unbase64 } from './bytes';

const OLD = 'a'.repeat(24);

class Device {
  readonly docs = new Map<string, Y.Doc>();
  readonly storage = new Map<string, string>();
  readonly local = new Map<string, CryptoKey>();
  constructor(
    readonly me: string,
    readonly paired = true,
    public synced = true,
    public clock = Date.now(),
  ) {
    this.storage.set(CURRENT_ACCOUNT_KEY, OLD);
  }
  open = async (id: string): Promise<Y.Doc> => this.docs.get(id) ?? this.docs.set(id, new Y.Doc()).get(id)!;
  keys: LocalAccountKeys = {
    get: async (fp) => this.local.get(fp),
    save: async (fp, k) => void this.local.set(fp, k),
    drop: async (fp) => void this.local.delete(fp),
  };
  get id(): string {
    return this.storage.get(CURRENT_ACCOUNT_KEY) as string;
  }
  get doc(): Y.Doc {
    return this.docs.get(accountDocId(this.id)) as Y.Doc;
  }
  env(): SettleEnv {
    return { open: this.open, storage: { getItem: (k) => this.storage.get(k) ?? null, setItem: (k, v) => void this.storage.set(k, v) }, keys: this.keys, me: this.me, paired: this.paired, synced: this.synced, now: () => this.clock };
  }
  /** What a start does (main.tsx): open the account, settle, and fold the old document in once (#295). */
  async start() {
    const doc = await this.open(accountDocId(this.id));
    const r = await settleAccount(this.env(), this.id, doc);
    const legacy = this.storage.get(LEGACY_KEY);
    if (legacy && legacy !== this.id) Y.applyUpdate(await this.open(accountDocId(this.id)), Y.encodeStateAsUpdate(await this.open(accountDocId(legacy))));
    if (legacy) this.storage.set(LEGACY_KEY, '');
    return r;
  }
}

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

function seeded(): Y.Doc {
  const d = new Y.Doc();
  addSpace(d, 'p1', 'Personal');
  return d;
}

describe('moving an account to its fingerprint id', () => {
  it('copies the document to the new id and stops using the old one', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    const r = await a.start();
    expect(r.status).toBe('moved');
    expect(a.id).not.toBe(OLD);
    expect(a.id).toMatch(/^[a-f0-9]{24}$/);
    expect(a.storage.get(LEGACY_KEY)).toBe('');
    // The old document is left as it was.
    expect(readSpaces(a.docs.get(accountDocId(OLD))!).map((s) => s.name)).toEqual(['Personal']);
    await a.start();
    expect(readSpaces(a.doc).map((s) => s.name)).toEqual(['Personal']);
    expect((await a.start()).status).toBe('unchanged');
  });

  it('a device moved by a build with the bridge folds the old document in once and forgets the old id (#295)', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const moved = a.id;
    // As the #294 build left it: the old id kept, and an edit an older build made there.
    a.storage.set(LEGACY_KEY, OLD);
    addSpace(a.docs.get(accountDocId(OLD))!, 'work', 'Work', new Date(Date.now() + 5).toISOString());
    expect((await a.start()).status).toBe('unchanged');
    expect(a.id).toBe(moved);
    expect(a.storage.get(LEGACY_KEY)).toBe('');
    expect(readSpaces(a.doc).map((s) => s.name).sort()).toEqual(['Personal', 'Work']);
  });

  it('does not make a key on a joining device that has no data yet', async () => {
    const joiner = new Device('devJ');
    const r = await joiner.start();
    expect(r.status).toBe('waiting');
    expect(joiner.id).toBe(OLD);
    expect(joiner.local.size).toBe(0);
  });

  it('an unpaired device moves without keeping the old id', async () => {
    const solo = new Device('devS', false);
    Y.applyUpdate(await solo.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    expect((await solo.start()).status).toBe('moved');
    expect(solo.storage.get(LEGACY_KEY)).toBeUndefined();
    expect(readSpaces(solo.doc)).toHaveLength(1);
  });
});

describe('account key records', () => {
  it('ignores an account key whose fingerprint does not match', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const [good] = await readAccountKeys(a.doc);
    const keys = a.doc.getMap<unknown>('keys');
    keys.set(`account:${'0'.repeat(32)}`, { public: good!.publicKey, by: 'evil' });
    keys.set(`account:${'1'.repeat(32)}`, { public: { kty: 'EC', crv: 'P-256', x: 'x', y: 'y' }, by: 'evil' });
    expect((await readAccountKeys(a.doc)).map((k) => k.fingerprint)).toEqual([good!.fingerprint]);
  });

  it('seals the private key with the passphrase; a restore with the right one brings it back, another passphrase does not', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const win = (await winningAccountKey(a.doc))!;
    expect(isSealed(a.doc, win.fingerprint)).toBe(false);
    expect(await sealAccount(a.env(), a.doc, 'correct horse battery', 100_000)).toBe('sealed');
    expect(isSealed(a.doc, win.fingerprint)).toBe(true);
    expect(a.local.size).toBe(0);
    // A fresh browser restoring the account document (a backup) and typing the passphrase.
    const restored = new Y.Doc();
    Y.applyUpdate(restored, Y.encodeStateAsUpdate(a.doc));
    await expect(unsealAccountKey(restored, win.fingerprint, 'wrong passphrase')).rejects.toBeInstanceOf(WrongPassphraseError);
    const back = await unsealAccountKey(restored, win.fingerprint, 'correct horse battery');
    const data = new TextEncoder().encode('proof');
    const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, back!, data));
    const { verify } = await import('./keys');
    expect(await verify(win.publicKey, data, sig)).toBe(true);
  });

  it('the stored backup key of a device cannot unseal the account key', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    // What a device keeps in IndexedDB after the passphrase was entered (S18): the backup key.
    const made = await newEncryption('correct horse battery', 100_000);
    const stored = await keyFor('correct horse battery', made.params);
    await sealAccount(a.env(), a.doc, 'correct horse battery', 100_000);
    const win = (await winningAccountKey(a.doc))!;
    const record = a.doc.getMap<{ data: string }>('keys').get(`sealed:${win.fingerprint}`)!;
    await expect(decryptBytes(stored, unbase64(record.data))).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('a paired device that was offline during the update follows the account key instead of making its own', async () => {
    const base = seeded();
    const a = new Device('devA');
    const late = new Device('devLate', true, false);
    for (const d of [a, late]) Y.applyUpdate(await d.open(accountDocId(OLD)), Y.encodeStateAsUpdate(base));
    await a.start();
    const keyA = (await winningAccountKey(a.doc))!;
    // Not yet connected to a peer: no key of its own.
    expect((await late.start()).status).toBe('waiting');
    expect(late.local.size).toBe(0);
    // The old document reaches it through a peer, with the key in it; its own clock is much later.
    sync(a.docs.get(accountDocId(OLD))!, late.docs.get(accountDocId(OLD))!);
    late.synced = true;
    late.clock += 3 * 24 * 3600_000;
    expect((await late.start()).status).toBe('moved');
    expect(late.id).toBe(a.id);
    expect(late.local.size).toBe(0);
    expect((await readAccountKeys(late.doc)).map((k) => k.fingerprint)).toEqual([keyA.fingerprint]);
  });

  it('a key published later, even with a lower fingerprint or a backdated time, changes nothing: the document decides', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const settled = a.id;
    const mine = (await winningAccountKey(a.doc))!;
    let low: Awaited<ReturnType<typeof generateAccountKey>>;
    let lowFp = '';
    do {
      low = await generateAccountKey();
      lowFp = await fingerprint(low.publicKey);
    } while (lowFp >= mine.fingerprint);
    // A peer grinds for a lower fingerprint and backdates it.
    publishAccountKey(a.doc, lowFp, low.publicKey, 'grinder', 0);
    expect((await a.start()).status).toBe('unchanged');
    expect(a.id).toBe(settled);
    expect(a.local.has(mine.fingerprint)).toBe(true);
  });

  it('devices still on the old id, and one joining, follow the key the first device chose, whatever the clocks', async () => {
    const base = seeded();
    const a = new Device('devA');
    const b = new Device('devB');
    for (const d of [a, b]) Y.applyUpdate(await d.open(accountDocId(OLD)), Y.encodeStateAsUpdate(base));
    // A settles first; B, its clock far behind, gets the old document from it before it settles.
    // (Two devices making the first key at the same moment would split now that no bridge joins them: accepted, #295.)
    b.clock = 1000;
    await a.start();
    sync(a.docs.get(accountDocId(OLD))!, b.docs.get(accountDocId(OLD))!);
    await b.start();
    expect(a.id).toBe(b.id);
    // A third device still on the old id, and one that joined with no state yet, follow the same key.
    const c = new Device('devC');
    Y.applyUpdate(await c.open(accountDocId(OLD)), Y.encodeStateAsUpdate(a.docs.get(accountDocId(OLD))!));
    await c.start();
    expect(c.id).toBe(a.id);
    const d = new Device('devD', true, true);
    Y.applyUpdate(await d.open(accountDocId(OLD)), Y.encodeStateAsUpdate(b.docs.get(accountDocId(OLD))!));
    await d.start();
    expect(d.id).toBe(a.id);
    // Two sealed keys: all still agree on the chosen one.
    const e1 = await generateAccountKey();
    const e2 = await generateAccountKey();
    for (const e of [e1, e2]) publishAccountKey(a.doc, await fingerprint(e.publicKey), e.publicKey, 'x', 0);
    expect((await a.start()).status).toBe('unchanged');
  });

  it('chooseAccountKey follows the chosen fingerprint only', () => {
    const k = (fp: string, sealed: boolean) => ({ fingerprint: fp.repeat(32), publicKey: {} as never, by: 'x', at: 0, sealed });
    const keys = [k('1', false), k('2', true), k('3', true)];
    expect(chooseAccountKey(keys, '3'.repeat(32))?.fingerprint).toBe('3'.repeat(32));
    expect(chooseAccountKey(keys, 'f'.repeat(32))).toBeUndefined();
    expect(chooseAccountKey(keys, undefined)).toBeUndefined();
    expect(pickAccountKey(keys)?.fingerprint).toBe('2'.repeat(32));
  });

  it('a device with the passphrase replaces an unsealed key whose creator is gone, and everyone follows the sealed one', async () => {
    const a = new Device('devA');
    const b = new Device('devB');
    const base = seeded();
    for (const d of [a, b]) Y.applyUpdate(await d.open(accountDocId(OLD)), Y.encodeStateAsUpdate(base));
    await a.start();
    sync(a.docs.get(accountDocId(OLD))!, b.docs.get(accountDocId(OLD))!);
    a.clock += 1000;
    b.clock = a.clock;
    await b.start();
    // The creator is still around and may seal: B does nothing.
    expect(await sealAccount(b.env(), b.doc, 'correct horse battery', 100_000)).toBe('none');
    // The creator is removed before it sealed: B replaces the key.
    setRemoved(b.doc, 'devA', true);
    expect(await sealAccount(b.env(), b.doc, 'correct horse battery', 100_000)).toBe('replaced');
    const sealed = (await readAccountKeys(b.doc)).filter((k) => k.sealed);
    expect(sealed).toHaveLength(1);
    expect((await b.start()).status).toBe('moved');
    expect(b.id).toBe(accountIdOfFingerprint(sealed[0]!.fingerprint));
  });

  it('skips a malformed key record instead of failing the whole read', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const m = a.doc.getMap<unknown>('keys');
    const long = 'A'.repeat(64);
    m.set(`account:${'2'.repeat(32)}`, { public: { kty: 'EC', crv: 'P-256', x: long, y: long }, by: 'evil', at: 0 });
    m.set(`account:${'3'.repeat(32)}`, { public: { kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) }, by: 'evil', at: 'x' });
    expect((await readAccountKeys(a.doc)).map((k) => k.by)).toEqual([a.me]);
    expect((await a.start()).status).toBe('unchanged');
  });

  it('drops the losing private key even when the device did not move', async () => {
    const a = new Device('devA');
    Y.applyUpdate(await a.open(accountDocId(OLD)), Y.encodeStateAsUpdate(seeded()));
    await a.start();
    const extra = await generateAccountKey();
    const fp = await fingerprint(extra.publicKey);
    a.local.set(fp, extra.privateKey);
    publishAccountKey(a.doc, fp, extra.publicKey, a.me, a.clock);
    await a.start();
    expect(a.local.size).toBe(1);
  });

  it('publishes device keys once and reads them back', async () => {
    const doc = new Y.Doc();
    const d = await generateDeviceKeys();
    publishDeviceKeys(doc, 'dev1', d.publicKeys);
    const before = Y.encodeStateVector(doc);
    publishDeviceKeys(doc, 'dev1', d.publicKeys);
    expect(Y.encodeStateVector(doc)).toEqual(before);
    expect(readDeviceKeys(doc).get('dev1')?.sign).toEqual(d.publicKeys.sign);
    doc.getMap('keys').set('device:bad', { sign: 1 });
    expect(readDeviceKeys(doc).has('bad')).toBe(false);
  });
});
