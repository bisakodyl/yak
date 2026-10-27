import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { keysMap, publishAccountKey } from './account-keys';
import { certifyDevice, readCerts } from './key-certs';
import { grantSpace, keyId, maintainGrants, openGrant, readGrants } from './key-grants';
import { setKeeps } from './keeps';
import { fingerprint, generateAccountKey, generateDeviceKeys, type DeviceKeyPairs } from './keys';

async function account(ids: string[]) {
  const doc = new Y.Doc();
  const acc = await generateAccountKey();
  const fp = await fingerprint(acc.publicKey);
  publishAccountKey(doc, fp, acc.publicKey, ids[0] as string, 0);
  const devices = new Map<string, DeviceKeyPairs>();
  for (const id of ids) {
    const d = await generateDeviceKeys();
    devices.set(id, d);
    await certifyDevice(doc, fp, acc.privateKey, id, d.publicKeys);
  }
  return { doc, fp, acc, devices };
}

async function maintain(doc: Y.Doc, fp: string, me: string, d: DeviceKeyPairs) {
  const certs = await readCerts(doc, fp);
  return maintainGrants(doc, { me, spaces: ['s1'], certs, grants: await readGrants(doc, fp, certs), signKey: d.sign.privateKey, agreeKey: d.agree.privateKey });
}

describe('space keys for own devices', () => {
  it('the first device that keeps a space makes its key, and a holder wraps it to every certified device that keeps it', async () => {
    const { doc, fp, devices } = await account(['a', 'b', 'c']);
    for (const id of ['a', 'b']) setKeeps(doc, id, 's1', true);
    expect(await maintain(doc, fp, 'b', devices.get('b')!)).toBe(1);
    expect(await maintain(doc, fp, 'b', devices.get('b')!)).toBe(1);
    const g = (await readGrants(doc, fp, await readCerts(doc, fp))).get('s1')!;
    expect([...g.holders].sort()).toEqual(['a', 'b']);
    const ka = await openGrant(doc, 's1', g, 'a', devices.get('a')!.agree.privateKey);
    const kb = await openGrant(doc, 's1', g, 'b', devices.get('b')!.agree.privateKey);
    expect(ka && Array.from(ka)).toEqual(kb && Array.from(kb));
    // c does not keep it: nothing for c.
    expect(await maintain(doc, fp, 'b', devices.get('b')!)).toBe(0);
  });

  it('two first keys made at once converge on the one the marker names', async () => {
    const { doc, fp, devices } = await account(['a', 'b']);
    for (const id of ['a', 'b']) setKeeps(doc, id, 's1', true);
    const docB = new Y.Doc();
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
    await maintain(doc, fp, 'a', devices.get('a')!);
    await maintain(docB, fp, 'b', devices.get('b')!);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(doc));
    for (const [id, d] of [...devices]) await maintain(id === 'a' ? doc : docB, fp, id, d);
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(docB));
    const g = (await readGrants(doc, fp, await readCerts(doc, fp))).get('s1')!;
    expect([...g.holders].sort()).toEqual(['a', 'b']);
    expect(g.kid).toBe(keysMap(doc).get('established:s1:1'));
  });

  it('a later key with a lower id replaces nothing, nor a key for another epoch', async () => {
    const { doc, fp, devices } = await account(['a', 'b']);
    for (const id of ['a', 'b']) setKeeps(doc, id, 's1', true);
    await maintain(doc, fp, 'a', devices.get('a')!);
    await maintain(doc, fp, 'a', devices.get('a')!);
    const first = (await readGrants(doc, fp, await readCerts(doc, fp))).get('s1')!;
    // b grinds keys until one has a lower id than the established one, and grants it to itself.
    let key = crypto.getRandomValues(new Uint8Array(32));
    // An established id this low is rare; the grind would take long, and there is nothing lower to try.
    if (first.kid.startsWith('000')) return;
    while ((await keyId(key)) >= first.kid) key = crypto.getRandomValues(new Uint8Array(32));
    const bSigner = { deviceId: 'b', key: devices.get('b')!.sign.privateKey };
    await grantSpace(doc, 's1', 1, key, { deviceId: 'b', agree: devices.get('b')!.publicKeys.agree }, bSigner);
    await grantSpace(doc, 's1', 2, key, { deviceId: 'b', agree: devices.get('b')!.publicKeys.agree }, bSigner);
    const after = (await readGrants(doc, fp, await readCerts(doc, fp))).get('s1')!;
    expect(after.kid).toBe(first.kid);
    expect(after.epoch).toBe(1);
  });

  it('ignores a grant from an uncertified signer or to an uncertified device', async () => {
    const { doc, fp, devices } = await account(['a']);
    const stranger = await generateDeviceKeys();
    const key = crypto.getRandomValues(new Uint8Array(32));
    await grantSpace(doc, 's1', 1, key, { deviceId: 'a', agree: devices.get('a')!.publicKeys.agree }, { deviceId: 'x', key: stranger.sign.privateKey });
    await grantSpace(doc, 's2', 1, key, { deviceId: 'x', agree: stranger.publicKeys.agree }, { deviceId: 'a', key: devices.get('a')!.sign.privateKey });
    // Claims to be signed by a, signed by someone else.
    await grantSpace(doc, 's3', 1, key, { deviceId: 'a', agree: devices.get('a')!.publicKeys.agree }, { deviceId: 'a', key: stranger.sign.privateKey });
    expect((await readGrants(doc, fp, await readCerts(doc, fp))).size).toBe(0);
    keysMap(doc).set('grant:bad', { kid: 1 });
    expect((await readGrants(doc, fp, await readCerts(doc, fp))).size).toBe(0);
  });
});
