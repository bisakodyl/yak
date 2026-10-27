import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { keysMap, publishAccountKey } from '../core/account-keys';
import { certifyDevice } from '../core/key-certs';
import { fingerprint, generateAccountKey, generateDeviceKeys } from '../core/keys';
import { addMember, createShare, endMember, memoryPins, readShare, rosterRecordsFor, setShareAnchor } from '../core/shares';
import { applyShareTrust, ShareTrust } from './share-trust';

const S = 'a'.repeat(24);

async function account(deviceIds: string[]) {
  const k = await generateAccountKey();
  const fp = await fingerprint(k.publicKey);
  const doc = new Y.Doc();
  publishAccountKey(doc, fp, k.publicKey, 'dev', 0);
  const keys = new Map<string, Awaited<ReturnType<typeof generateDeviceKeys>>>();
  for (const id of deviceIds) {
    const d = await generateDeviceKeys();
    keys.set(id, d);
    await certifyDevice(doc, fp, k.privateKey, id, d.publicKeys, true);
  }
  const records = await rosterRecordsFor(fp, k.publicKey, [...keysMap(doc).entries()].filter(([key]) => /^cert:/.test(key)));
  return { fp, key: k.publicKey, priv: k.privateKey, doc, keys, records };
}

describe('the trust of a share mesh (#259)', () => {
  it('follows the roster: peers are the other member accounts devices, and own() stops once the account is ended', async () => {
    const a = await account(['a1']);
    const b = await account(['b1', 'b2']);
    const room = new Y.Doc();
    await createShare(room, S, a.fp, a.key, a.priv, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23');
    await addMember(room, S, a.priv, { fp: b.fp, key: b.key, n: 1 }, b.records);
    const pins = memoryPins();
    const proofOf = (acc: typeof a, id: string) => ({ sign: acc.keys.get(id)!.sign.privateKey, agree: acc.keys.get(id)!.agree.privateKey });

    // Device b1 of the member account.
    const trust = new ShareTrust();
    expect(trust.own()).toBeUndefined();
    expect(trust.blocked('a1')).toBe(true);
    const anchor = new Y.Doc();
    setShareAnchor(anchor, S, a.fp);
    expect(applyShareTrust(trust, b.fp, proofOf(b, 'b1'), await readShare(room, S, a.fp, pins))).toBe(true);
    expect(trust.required()).toBe(true);
    expect(trust.own()).toBeDefined();
    // The owner has no copied certificates yet, and b2 is its own account's device: no peers.
    expect([...trust.peers.keys()]).toEqual([]);
    expect(trust.blocked('b2')).toBe(true);

    // The owner's device copies its certificate in: now a peer.
    await createShareRecords(room, a);
    applyShareTrust(trust, b.fp, proofOf(b, 'b1'), await readShare(room, S, a.fp, pins));
    expect([...trust.peers.keys()]).toEqual(['a1']);
    expect(trust.peer('a1')?.sign).toEqual(a.keys.get('a1')!.publicKeys.sign);
    expect(trust.blocked('a1')).toBe(false);
    expect(trust.blocked('b2')).toBe(true);

    // The owner ends the member: this device has nothing to prove and no peers.
    await endMember(room, S, a.priv, b.fp, 1);
    expect(applyShareTrust(trust, b.fp, proofOf(b, 'b1'), await readShare(room, S, a.fp, pins))).toBe(true);
    expect(trust.own()).toBeUndefined();
    expect(trust.peers.size).toBe(0);
    // Deleting the end afterwards changes nothing here (pinned).
    room.getMap('share').delete(`end:${b.fp}:1`);
    applyShareTrust(trust, b.fp, proofOf(b, 'b1'), await readShare(room, S, a.fp, pins));
    expect(trust.own()).toBeUndefined();
    // Leaving (the anchor is gone): not a share here.
    applyShareTrust(trust, b.fp, proofOf(b, 'b1'), await readShare(room, S, undefined, pins));
    expect(trust.active).toBe(false);
  });

  it('the owner sees member devices as peers', async () => {
    const a = await account(['a1']);
    const b = await account(['b1']);
    const room = new Y.Doc();
    await createShare(room, S, a.fp, a.key, a.priv, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23');
    await addMember(room, S, a.priv, { fp: b.fp, key: b.key, n: 1 }, b.records);
    const trust = new ShareTrust();
    applyShareTrust(trust, a.fp, { sign: a.keys.get('a1')!.sign.privateKey, agree: a.keys.get('a1')!.agree.privateKey }, await readShare(room, S, a.fp, memoryPins()));
    expect([...trust.peers.keys()]).toEqual(['b1']);
    expect(trust.accountOf.get('b1')).toBe(b.fp);
  });
});

async function createShareRecords(room: Y.Doc, a: Awaited<ReturnType<typeof account>>): Promise<void> {
  for (const [k, v] of a.records) room.getMap('share').set(k, v);
}
