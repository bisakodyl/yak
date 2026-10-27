import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { addSpace } from './account';
import { keysMap, publishAccountKey } from './account-keys';
import { certifyDevice, readCerts } from './key-certs';
import { readRemovals, removeDevices } from './key-removals';
import { fingerprint, generateAccountKey, generateDeviceKeys, type PublicKeyJwk } from './keys';
import { addMember, clearShareAnchor, copyOwnRecords, createShare, endMember, memoryPins, nextGeneration, readShare, rosterRecordsFor, setShareAnchor, shareAnchor, shareMap, sharedSpaces } from './shares';

const S = 'a'.repeat(24);
const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23';

interface Account {
  fp: string;
  key: PublicKeyJwk;
  priv: CryptoKey;
  doc: Y.Doc;
}

async function account(): Promise<Account> {
  const k = await generateAccountKey();
  const fp = await fingerprint(k.publicKey);
  const doc = new Y.Doc();
  publishAccountKey(doc, fp, k.publicKey, 'dev', 0);
  return { fp, key: k.publicKey, priv: k.privateKey, doc };
}

/** An approved (version 2) certificate for a device of the account. */
async function device(a: Account, id: string) {
  const keys = await generateDeviceKeys();
  await certifyDevice(a.doc, a.fp, a.priv, id, keys.publicKeys, true);
  return keys;
}

/** The raw `cert:` / `removal:` records an asking account would send. */
const rawRecords = (a: Account): [string, unknown][] => [...keysMap(a.doc).entries()].filter(([k]) => /^(cert|removal):/.test(k));

async function shared() {
  const owner = await account();
  const room = new Y.Doc();
  await createShare(room, S, owner.fp, owner.key, owner.priv, SECRET, 'Owner');
  const anchor = new Y.Doc();
  setShareAnchor(anchor, S, owner.fp);
  return { owner, room, anchor, pins: memoryPins() };
}

const read = (s: Awaited<ReturnType<typeof shared>>, ...anchor: (string | undefined)[]) => readShare(s.room, S, anchor.length ? anchor[0] : s.owner.fp, s.pins);

describe('the share record and its anchor', () => {
  it('is a share only with the anchor, the owner key hashing to it and the owner signature', async () => {
    const s = await shared();
    expect((await read(s))?.secret).toBe(SECRET);
    expect(await read(s, undefined)).toBeUndefined();
    expect(await read(s, 'b'.repeat(32))).toBeUndefined();
    const stranger = await account();
    // Another owner's key claiming the anchor's fingerprint.
    const forged = new Y.Doc();
    shareMap(forged).set('share', { ...(shareMap(s.room).get('share') as object), key: stranger.key });
    expect(await readShare(forged, S, s.owner.fp, memoryPins())).toBeUndefined();
    // A changed secret.
    const changed = new Y.Doc();
    shareMap(changed).set('share', { ...(shareMap(s.room).get('share') as object), secret: 'B' + SECRET.slice(1) });
    expect(await readShare(changed, S, s.owner.fp, memoryPins())).toBeUndefined();
    // Copied from another space.
    expect(await readShare(s.room, 'c'.repeat(24), s.owner.fp, memoryPins())).toBeUndefined();
    // A record by someone else who made the anchor's fingerprint theirs.
    const own = new Y.Doc();
    await createShare(own, S, stranger.fp, stranger.key, stranger.priv, SECRET);
    expect(await readShare(own, S, s.owner.fp, memoryPins())).toBeUndefined();
  });

  it('keeps an existing record of the same owner', async () => {
    const s = await shared();
    expect(await createShare(s.room, S, s.owner.fp, s.owner.key, s.owner.priv, 'BBBBBBBBBBBBBBBBBBBBBBBBBB22')).toBe(SECRET);
  });

  it('lists the shares of an account and forgets one on leaving', () => {
    const doc = new Y.Doc();
    addSpace(doc, S, 'Team');
    setShareAnchor(doc, S, 'a'.repeat(32));
    expect(shareAnchor(doc, S)).toBe('a'.repeat(32));
    expect([...sharedSpaces(doc)]).toEqual([[S, 'a'.repeat(32)]]);
    clearShareAnchor(doc, S);
    expect(sharedSpaces(doc).size).toBe(0);
  });
});

describe('members and ends', () => {
  it('a member the owner signed is active; an end by the owner ends it; nobody else can end it', async () => {
    const s = await shared();
    const b = await account();
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1, name: 'B' }, []);
    expect([...(await read(s))!.members.keys()].sort()).toEqual([s.owner.fp, b.fp].sort());
    // An end signed by the member itself does not count.
    const sig = (shareMap(s.room).get('member:' + b.fp) as { sig: string }).sig;
    shareMap(s.room).set(`end:${b.fp}:1`, { sig });
    expect((await read(s))!.members.has(b.fp)).toBe(true);
    await endMember(s.room, S, s.owner.priv, b.fp, 1);
    const state = (await read(s))!;
    expect(state.members.has(b.fp)).toBe(false);
    expect(state.ended.get(b.fp)).toBe(1);
  });

  it('a member record not signed by the owner, or naming another key, is ignored', async () => {
    const s = await shared();
    const b = await account();
    const evil = await account();
    await addMember(s.room, S, evil.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    expect((await read(s))!.members.has(b.fp)).toBe(false);
    // Signed by the owner for B's key, filed under another fingerprint.
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    shareMap(s.room).set(`member:${evil.fp}`, shareMap(s.room).get(`member:${b.fp}`));
    const state = (await read(s))!;
    expect(state.members.has(b.fp)).toBe(true);
    expect(state.members.has(evil.fp)).toBe(false);
  });

  it('a member record copied from another space does not count', async () => {
    const s = await shared();
    const b = await account();
    const other = new Y.Doc();
    await createShare(other, 'd'.repeat(24), s.owner.fp, s.owner.key, s.owner.priv, SECRET);
    await addMember(other, 'd'.repeat(24), s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    shareMap(s.room).set(`member:${b.fp}`, shareMap(other).get(`member:${b.fp}`));
    expect((await read(s))!.members.has(b.fp)).toBe(false);
  });

  it('deleting an end after it was seen changes nothing; n + 1 re-adds, n does not', async () => {
    const s = await shared();
    const b = await account();
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    await endMember(s.room, S, s.owner.priv, b.fp, 1);
    expect((await read(s))!.members.has(b.fp)).toBe(false);
    shareMap(s.room).delete(`end:${b.fp}:1`);
    expect((await read(s))!.members.has(b.fp)).toBe(false);
    expect((await read(s))!.ended.get(b.fp)).toBe(1);
    // The same generation again (a replayed old record) does not come back.
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    expect((await read(s))!.members.has(b.fp)).toBe(false);
    expect(nextGeneration(s.room, b.fp, s.pins.load(S))).toBe(2);
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 2 }, []);
    expect((await read(s))!.members.has(b.fp)).toBe(true);
  });

  it('a device that never saw the end does not pin it', async () => {
    const s = await shared();
    const b = await account();
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    const later = memoryPins();
    expect((await readShare(s.room, S, s.owner.fp, later))!.members.has(b.fp)).toBe(true);
  });
});

describe('devices of member accounts', () => {
  it('counts a certificate only for an active member, version 2, signed by that member', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'b1');
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, await rosterRecordsFor(b.fp, b.key, rawRecords(b)));
    expect([...(await read(s))!.devices.keys()]).toEqual(['b1']);
    expect((await read(s))!.devices.get('b1')!.fp).toBe(b.fp);
    await endMember(s.room, S, s.owner.priv, b.fp, 1);
    expect((await read(s))!.devices.size).toBe(0);
  });

  it('refuses a version 1 certificate, a certificate another key signed and a copy under the wrong account', async () => {
    const s = await shared();
    const b = await account();
    const c = await account();
    const keys = await generateDeviceKeys();
    await certifyDevice(b.doc, b.fp, b.priv, 'old', keys.publicKeys, false);
    await device(c, 'c1');
    // Neither is filed by rosterRecordsFor.
    expect(await rosterRecordsFor(b.fp, b.key, rawRecords(b))).toEqual([]);
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    shareMap(s.room).set(`cert:${b.fp}:old`, keysMap(b.doc).get('cert:old'));
    shareMap(s.room).set(`cert:${b.fp}:c1`, keysMap(c.doc).get('cert:c1'));
    expect((await read(s))!.devices.size).toBe(0);
  });

  it('a device id certified under two accounts counts for neither', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'same');
    await device(s.owner, 'same');
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, await rosterRecordsFor(b.fp, b.key, rawRecords(b)));
    shareMap(s.room).set(`cert:${s.owner.fp}:same`, keysMap(s.owner.doc).get('cert:same'));
    expect((await read(s))!.devices.has('same')).toBe(false);
  });

  it('a signed removal drops the device, and deleting the record after it was seen changes nothing', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'b1');
    await device(b, 'b2');
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, await rosterRecordsFor(b.fp, b.key, rawRecords(b)));
    expect((await read(s))!.devices.size).toBe(2);
    const certs = await readCerts(b.doc, b.fp, undefined, true);
    await removeDevices(b.doc, b.fp, b.priv, [certs.get('b2')!]);
    for (const [k, v] of await rosterRecordsFor(b.fp, b.key, rawRecords(b))) shareMap(s.room).set(k, v);
    expect([...(await read(s))!.devices.keys()]).toEqual(['b1']);
    shareMap(s.room).delete(`removal:${b.fp}:b2`);
    expect([...(await read(s))!.devices.keys()]).toEqual(['b1']);
  });

  it('a removal not signed by the member is ignored', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'b1');
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, await rosterRecordsFor(b.fp, b.key, rawRecords(b)));
    const certs = await readCerts(b.doc, b.fp, undefined, true);
    const other = await account();
    await removeDevices(other.doc, other.fp, other.priv, [certs.get('b1')!]);
    shareMap(s.room).set(`removal:${b.fp}:b1`, keysMap(other.doc).get('removal:b1'));
    expect((await read(s))!.devices.has('b1')).toBe(true);
  });
});

describe('copying the own account records into the roster', () => {
  it('writes only its own approved certificates and removals, and nothing when equal', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'b1');
    await device(b, 'b2');
    await addMember(s.room, S, s.owner.priv, { fp: b.fp, key: b.key, n: 1 }, []);
    const certs = await readCerts(b.doc, b.fp, undefined, true);
    const own = { fp: b.fp, certs, removals: await readRemovals(b.doc, { fingerprint: b.fp, publicKey: b.key, by: '', at: 0, sealed: false }), keys: keysMap(b.doc) };
    const state = (await read(s))!;
    expect(copyOwnRecords(s.room, state, own)).toBe(2);
    expect(copyOwnRecords(s.room, state, own)).toBe(0);
    expect([...shareMap(s.room).keys()].filter((k) => k.startsWith('cert:')).sort()).toEqual([`cert:${b.fp}:b1`, `cert:${b.fp}:b2`]);
    expect((await read(s))!.devices.size).toBe(2);
  });

  it('does nothing for an account that is not an active member', async () => {
    const s = await shared();
    const b = await account();
    await device(b, 'b1');
    const own = { fp: b.fp, certs: await readCerts(b.doc, b.fp, undefined, true), removals: [], keys: keysMap(b.doc) };
    expect(copyOwnRecords(s.room, (await read(s))!, own)).toBe(0);
    expect([...shareMap(s.room).keys()].some((k) => k.startsWith('cert:'))).toBe(false);
  });
});
