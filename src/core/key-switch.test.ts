import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { keysMap, KEYS_REQUIRED_LEVEL, publishAccountKey, publishDeviceKeys, readDeviceKey, sealAccountKey } from './account-keys';
import { certifyDevice, keysRequired, readCerts, requireKeys } from './key-certs';
import { docVersion, KEYS_REQUIRED_DOC_VERSION, NEW_DOC_VERSION, SUPPORTED_DOC_VERSION, watchTooNew } from './migrations';
import { initSpaceDoc } from './schema';
import { fingerprint, generateAccountKey, generateDeviceKeys } from './keys';

/** Slice 3 (#257): approved certificates and the switch. */

async function account(doc: Y.Doc, by = 'devA') {
  const k = await generateAccountKey();
  const fp = await fingerprint(k.publicKey);
  publishAccountKey(doc, fp, k.publicKey, by, 0);
  await sealAccountKey(doc, fp, k.privateKey, 'correct horse battery', 100_000);
  return { ...k, fp };
}

async function device(doc: Y.Doc, id: string) {
  const k = await generateDeviceKeys();
  publishDeviceKeys(doc, id, k.publicKeys);
  return { deviceId: id, ...k.publicKeys };
}

describe('the switch (#257)', () => {
  it('counts only the devices the owner approved; certificates issued on first use stop counting', async () => {
    const doc = new Y.Doc();
    const a = await account(doc);
    const good = await device(doc, 'good');
    const hostile = await device(doc, 'hostile');
    // Compatible mode: both certified on first use.
    for (const d of [good, hostile]) await certifyDevice(doc, a.fp, a.privateKey, d.deviceId, d);
    expect([...(await readCerts(doc, a.fp)).keys()].sort()).toEqual(['good', 'hostile']);
    // The device that switches must be among the approved ones.
    await expect(requireKeys(doc, a.fp, a.privateKey, [good], 'hostile')).rejects.toThrow();
    expect(await keysRequired(doc, a.fp)).toBe(false);
    await requireKeys(doc, a.fp, a.privateKey, [good], 'good');
    expect(await keysRequired(doc, a.fp)).toBe(true);
    expect([...(await readCerts(doc, a.fp, undefined, true)).keys()]).toEqual(['good']);
    // Putting the old certificate back gains nothing: it is not an approval.
    const old = new Y.Doc();
    const b = await account(old);
    await certifyDevice(old, b.fp, b.privateKey, 'hostile', hostile);
    keysMap(doc).set('cert:hostile', { ...(keysMap(old).get('cert:hostile') as object), account: a.fp });
    expect([...(await readCerts(doc, a.fp, undefined, true)).keys()]).toEqual(['good']);
    // Claiming version 2 on a first-use certificate does not verify.
    await certifyDevice(doc, a.fp, a.privateKey, 'hostile', hostile);
    keysMap(doc).set('cert:hostile', { ...(keysMap(doc).get('cert:hostile') as object), v: 2 });
    expect([...(await readCerts(doc, a.fp, undefined, true)).keys()]).toEqual(['good']);
    // Approved later from Devices.
    await certifyDevice(doc, a.fp, a.privateKey, 'hostile', hostile, true);
    expect([...(await readCerts(doc, a.fp, undefined, true)).keys()].sort()).toEqual(['good', 'hostile']);
  });

  it('raises the account document to a version older builds do not read; new documents keep the old version', async () => {
    expect(SUPPORTED_DOC_VERSION).toBe(KEYS_REQUIRED_DOC_VERSION);
    expect(NEW_DOC_VERSION).toBe(1);
    const space = new Y.Doc();
    initSpaceDoc(space);
    expect(docVersion(space)).toBe(1);
    const doc = new Y.Doc();
    const a = await account(doc);
    let tooNewForOld = 0;
    watchTooNew(doc, () => tooNewForOld++, 1);
    let tooNewForThis = 0;
    watchTooNew(doc, () => tooNewForThis++);
    await requireKeys(doc, a.fp, a.privateKey, [await device(doc, 'me')], 'me');
    expect(docVersion(doc)).toBe(KEYS_REQUIRED_DOC_VERSION);
    expect(tooNewForOld).toBeGreaterThan(0);
    expect(tooNewForThis).toBe(0);
  });

  it('a device record says what its build understands, and an older record is upgraded once', async () => {
    const doc = new Y.Doc();
    const k = await generateDeviceKeys();
    keysMap(doc).set('device:d', { sign: k.publicKeys.sign, agree: k.publicKeys.agree });
    expect(readDeviceKey(doc, 'd')?.v).toBeUndefined();
    publishDeviceKeys(doc, 'd', k.publicKeys);
    expect(readDeviceKey(doc, 'd')?.v).toBe(KEYS_REQUIRED_LEVEL);
    let writes = 0;
    keysMap(doc).observe(() => writes++);
    publishDeviceKeys(doc, 'd', k.publicKeys);
    expect(writes).toBe(0);
  });
});

describe('stragglers', () => {
  it('lists devices without keys or with keys from an older build; removed and left devices do not count', async () => {
    const { switchDevices } = await import('./key-switch');
    const { setDeviceName, setLeft, setRemoved } = await import('./devices');
    const doc = new Y.Doc();
    await device(doc, 'ready');
    const old = await generateDeviceKeys();
    keysMap(doc).set('device:old', { sign: old.publicKeys.sign, agree: old.publicKeys.agree });
    setDeviceName(doc, 'nokeys', 'Vault');
    setDeviceName(doc, 'gone', 'Gone');
    setRemoved(doc, 'gone', true);
    setDeviceName(doc, 'left', 'Left');
    setLeft(doc, 'left', true);
    const states = Object.fromEntries(switchDevices(doc, ['seen']).map((d) => [d.id, d.state]));
    expect(states).toEqual({ ready: 'ready', old: 'old-build', nokeys: 'no-keys', seen: 'no-keys' });
  });
});
