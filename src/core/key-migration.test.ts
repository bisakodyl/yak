import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { publishAccountKey, publishDeviceKeys, readDeviceKey, sealAccountKey } from './account-keys';
import { certifyDevice, keysRequired, readCerts, requireKeys } from './key-certs';
import { fingerprint, generateAccountKey, generateDeviceKeys } from './keys';
import { switchDevices } from './key-switch';
import { docVersion, KEYS_REQUIRED_DOC_VERSION, migrationConverges, watchTooNew, type DocMigration } from './migrations';
import { collection, createRecord, initSpaceDoc } from './schema';
import { rejoinAccount } from '../app/leave';
import type { SyncService } from '../sync/sync-service';

/** The switch of keyless accounts to device keys (#311, F39): what converges, what an older build keeps, what a left-out device loses (nothing). */

const merge = (a: Y.Doc, b: Y.Doc): void => {
  const ua = Y.encodeStateAsUpdate(a);
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
  Y.applyUpdate(b, ua);
};
const clone = (d: Y.Doc): Y.Doc => {
  const c = new Y.Doc();
  Y.applyUpdate(c, Y.encodeStateAsUpdate(d));
  return c;
};

/** A keyless account document: an account key sealed with a passphrase, and devices that published keys (as updated builds do). */
async function keylessAccount(ids: string[]) {
  const doc = new Y.Doc();
  const k = await generateAccountKey();
  const fp = await fingerprint(k.publicKey);
  publishAccountKey(doc, fp, k.publicKey, ids[0] as string, 0);
  await sealAccountKey(doc, fp, k.privateKey, 'correct horse battery staple', 100_000);
  const devices: Record<string, Awaited<ReturnType<typeof generateDeviceKeys>>> = {};
  for (const id of ids) {
    devices[id] = await generateDeviceKeys();
    publishDeviceKeys(doc, id, devices[id].publicKeys);
  }
  return { doc, fp, key: k.privateKey, devices };
}

/** The step the switch declares: it applies to no document, so running it changes nothing (see `KEYS_REQUIRED_DOC_VERSION`). */
const declared: DocMigration = { id: 'keys-required', version: KEYS_REQUIRED_DOC_VERSION, applies: () => false, declared: true, run() {} };

describe('migrating keyless accounts to device keys', () => {
  it('the declared step converges and changes nothing on its own', async () => {
    const { doc } = await keylessAccount(['a', 'b']);
    const { a, b } = migrationConverges(doc, [declared], 'account/x');
    expect(a).toEqual(b);
    expect(docVersion(doc)).toBe(1);
  });

  it('two owners switching at once converge, and every approved device stays approved', async () => {
    const { doc, fp, key, devices } = await keylessAccount(['a', 'b', 'c']);
    const one = clone(doc);
    const two = clone(doc);
    const rec = (id: string) => readDeviceKey(doc, id) as NonNullable<ReturnType<typeof readDeviceKey>>;
    await requireKeys(one, fp, key, [rec('a'), rec('b')], 'a');
    await requireKeys(two, fp, key, [rec('a'), rec('c')], 'a');
    merge(one, two);
    expect(one.toJSON()).toEqual(two.toJSON());
    expect(await keysRequired(one, fp)).toBe(true);
    expect(docVersion(one)).toBe(KEYS_REQUIRED_DOC_VERSION);
    expect([...(await readCerts(one, fp, undefined, true)).keys()].sort()).toEqual(['a', 'b', 'c']);
    expect(devices).toBeDefined();
  });

  it('lists devices without keys as ready-less, so the switch does not wait for them', async () => {
    const { doc } = await keylessAccount(['a']);
    const list = switchDevices(doc, ['a', 'old']);
    expect(list.find((d) => d.id === 'a')?.state).toBe('ready');
    expect(list.find((d) => d.id === 'old')?.state).toBe('no-keys');
  });

  it('an older build stops writing the switched account document and loses none of its data', async () => {
    const { doc: owner, fp, key } = await keylessAccount(['new', 'old']);
    const oldDevice = clone(owner);
    // The older build understands document version 1 only.
    let tooNew = 0;
    watchTooNew(oldDevice, () => tooNew++, 1);
    const space = new Y.Doc();
    initSpaceDoc(space);
    const p1 = createRecord(space, 'projects', { name: 'before' });
    const oldSpace = clone(space);
    const p2 = createRecord(oldSpace, 'projects', { name: 'edited on the old device after the switch' });
    const before = Y.encodeStateAsUpdate(oldSpace);
    await requireKeys(owner, fp, key, [readDeviceKey(owner, 'new') as NonNullable<ReturnType<typeof readDeviceKey>>], 'new');
    // The switched document reaches the old build by sync: it notices, and its space document is untouched.
    Y.applyUpdate(oldDevice, Y.encodeStateAsUpdate(owner));
    expect(tooNew).toBeGreaterThan(0);
    expect(Y.encodeStateAsUpdate(oldSpace)).toEqual(before);
    expect(Object.keys(collection(oldSpace, 'projects').toJSON())).toEqual(expect.arrayContaining([p1, p2]));
  });

  it('a device left out joins again without losing anything, including edits made after the switch', async () => {
    const { doc: owner, fp, key, devices } = await keylessAccount(['new', 'left']);
    const rec = (id: string) => readDeviceKey(owner, id) as NonNullable<ReturnType<typeof readDeviceKey>>;
    const space = new Y.Doc();
    initSpaceDoc(space);
    const p1 = createRecord(space, 'projects', { name: 'before the switch' });
    const leftSpace = clone(space);
    const ownerSpace = clone(space);
    // The owner switches and approves itself only; the other device is left out.
    await requireKeys(owner, fp, key, [rec('new')], 'new');
    expect((await readCerts(owner, fp, undefined, true)).has('left')).toBe(false);
    // Both keep working; nothing reaches the left-out device.
    const p2 = createRecord(ownerSpace, 'projects', { name: 'owner, after' });
    const p3 = createRecord(leftSpace, 'projects', { name: 'left out, after' });

    // "Join again": it stops syncing and drops its keys; its documents stay byte for byte.
    const before = Y.encodeStateAsUpdate(leftSpace);
    let unpaired = 0;
    let dropped = 0;
    await rejoinAccount({
      sync: { unpair: () => void unpaired++ } as unknown as SyncService,
      dropKeys: async () => void dropped++,
    });
    expect(unpaired).toBe(1);
    expect(dropped).toBe(1);
    expect(Y.encodeStateAsUpdate(leftSpace)).toEqual(before);

    // Approved with its new keys (the approval path of a one-time code), it merges back in full.
    await certifyDevice(owner, fp, key, 'left', devices['left']!.publicKeys, true);
    expect((await readCerts(owner, fp, undefined, true)).has('left')).toBe(true);
    merge(ownerSpace, leftSpace);
    expect(ownerSpace.toJSON()).toEqual(leftSpace.toJSON());
    expect(Object.keys(collection(ownerSpace, 'projects').toJSON()).sort()).toEqual([p1, p2, p3].sort());
  });
});
