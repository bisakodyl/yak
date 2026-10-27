import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { publishAccountKey, publishDeviceKeys, readDeviceKey } from '../core/account-keys';
import { requireKeys } from '../core/key-certs';
import { removeDevices } from '../core/key-removals';
import { fingerprint, generateAccountKey, generateDeviceKeys, type DeviceKeyPairs } from '../core/keys';
import { computeTrust } from './key-trust';

describe('computeTrust (#258)', () => {
  it('a device sees the signed removal of its own keys; the others and a fresh key pair do not', async () => {
    const doc = new Y.Doc();
    const acc = await generateAccountKey();
    const fp = await fingerprint(acc.publicKey);
    publishAccountKey(doc, fp, acc.publicKey, 'a', 0);
    const devices = new Map<string, DeviceKeyPairs>();
    for (const id of ['a', 'b']) {
      const d = await generateDeviceKeys();
      devices.set(id, d);
      publishDeviceKeys(doc, id, d.publicKeys);
    }
    await requireKeys(doc, fp, acc.privateKey, ['a', 'b'].map((id) => readDeviceKey(doc, id)!), 'a');
    const trust = (me: string, own: DeviceKeyPairs) => computeTrust({ doc, fp, me, own, log: () => undefined });
    const before = await trust('a', devices.get('a')!);
    expect(before.removedSelf).toBe(false);
    await removeDevices(doc, fp, acc.privateKey, [before.certs.get('b')!]);
    expect((await trust('b', devices.get('b')!)).removedSelf).toBe(true);
    expect((await trust('a', devices.get('a')!)).removedSelf).toBe(false);
    // New keys after the device dropped the removed ones: not removed, waiting for a new approval.
    const fresh = await trust('b', await generateDeviceKeys());
    expect(fresh.removedSelf).toBe(false);
    expect(fresh.proof).toBeUndefined();
  });
});
