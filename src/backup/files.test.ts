import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { addAttachment, attachmentsMap, listAttachments } from '../core/blobs/attachments';
import { MemoryBlobStore } from '../core/blobs/store';
import { MemoryStore } from '../core/history/memory-store';
import { accountBlobSource, collectBlobs, folderBlobSource, restoreBlobs } from './blobs';
import { MIN_ITERATIONS, newEncryption, withKey } from './crypto';
import { MemoryDir, SubDir } from './dir';
import { blobPath } from './format';
import { openBackup } from './restore';
import { BackupService, type StoredStatus } from './service';
import { createSnapshot } from './snapshot';
import { memoryStore, seedSpace } from './testing';
import { ZipDir, readZip } from './zip';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const sha = async (b: Uint8Array): Promise<string> => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', b as Uint8Array<ArrayBuffer>)), (x) => x.toString(16).padStart(2, '0')).join('');
const stores = () => {
  const all = new Map<string, MemoryBlobStore>();
  return { all, of: (unit: string): MemoryBlobStore => all.get(unit) ?? (all.set(unit, new MemoryBlobStore()), all.get(unit)!) };
};

async function setup(opts: { encrypted?: boolean } = {}) {
  const store = memoryStore();
  const doc = await store.open('space/personal');
  seedSpace(doc, 'S');
  const blobs = stores();
  const note = await addAttachment(doc, blobs.of('personal'), new File(['hello files'], 'note.txt'), { persist: async () => true, estimate: async () => undefined });
  const img = await addAttachment(doc, blobs.of('personal'), new File([PNG], 'pic.png'), { persist: async () => true, estimate: async () => undefined });
  if (!note.ok || !img.ok) throw new Error('add failed');
  const root = new MemoryDir();
  let saved: StoredStatus = opts.encrypted ? { encrypted: true } : {};
  const ring = opts.encrypted ? await newEncryption('pw', MIN_ITERATIONS) : undefined;
  const service = new BackupService({
    docs: () => store.opened(),
    deviceId: 'cccc0000-1111',
    accountId: 'acct1',
    history: new MemoryStore(),
    blobs: blobs.of,
    keyring: ring ? async () => ring : undefined,
    folder: { current: async () => ({ state: 'granted' as const, id: 'f1', name: 'B', dir: root }) },
    status: { load: () => saved, save: (s) => (saved = s) },
  });
  return { store, doc, blobs, root, service, ring, note: note.attachment, img: img.attachment };
}

describe('files in folder backups', () => {
  it('copies each file once by hash, lists it in the manifest and keeps a readable copy beside the notes', async () => {
    const { root, service, note, img, doc } = await setup();
    const r = await service.run('manual', { force: true });
    if (r.status !== 'written') throw new Error(JSON.stringify(r));
    expect(r.manifest.blobs.map((b) => b.name).sort()).toEqual(['note.txt', 'pic.png']);
    expect(r.manifest.blob_storage).toBe('folder');
    expect(new TextDecoder().decode(root.files.get(`acct1/blobs/${note.hash}`))).toBe('hello files');
    expect(root.files.has(`acct1/blobs/${img.hash}`)).toBe(true);
    expect(new TextDecoder().decode(root.files.get('acct1/current/docs/space~personal/attachments/note.txt'))).toBe('hello files');
    // The restore point holds the index, never a copy of the bytes.
    expect([...root.files.keys()].filter((k) => k.includes('restore-points') && k.includes('attachments'))).toEqual([]);

    // A second run writes no file again.
    const writes: string[] = [];
    const orig = root.writeFile.bind(root);
    root.writeFile = async (p, d) => (writes.push(p), orig(p, d));
    await service.run('manual', { force: true });
    expect(writes.filter((p) => p.includes('blobs/') || p.includes('attachments/'))).toEqual([]);

    // A file removed from the notes leaves `current/` but stays in `blobs/` (backups never delete).
    attachmentsMap(doc).get(note.hash)?.set('deleted', true);
    await service.run('manual', { force: true });
    expect(root.files.has('acct1/current/docs/space~personal/attachments/note.txt')).toBe(false);
    expect(root.files.has(`acct1/blobs/${note.hash}`)).toBe(true);
  });

  it('counts files the notes list but this device does not hold yet', async () => {
    const { doc, blobs } = await setup();
    blobs.of('personal').files.clear();
    const found = await collectBlobs(new Map([['space/personal', doc as Y.Doc]]), blobs.of);
    expect(found).toMatchObject({ blobs: [], missing: 2 });
  });

  it('restores the files into an empty device, and brings back an index entry deleted here', async () => {
    const { root, service, doc, note } = await setup();
    await service.run('manual', { force: true });
    const name = [...new Set([...root.files.keys()].filter((k) => k.startsWith('acct1/restore-points/')).map((k) => k.split('/')[2]))][0];
    const point = new SubDir(root, `acct1/restore-points/${name}`);
    const backup = await openBackup(point, accountBlobSource(root, 'acct1', point));
    expect(backup.verification.ok).toBe(true);

    const fresh = stores();
    const r = await restoreBlobs(backup.manifest, backup.blobs!, fresh.of);
    expect(r).toEqual({ restored: 2, already: 0, unavailable: 0 });
    expect(new TextDecoder().decode(new Uint8Array(await (await fresh.of('personal').get(note.hash))!.blob.arrayBuffer()))).toBe('hello files');

    // Deleted here since: merge brings it back, because the bytes are in the backup.
    const entry = attachmentsMap(doc).get(note.hash)!;
    entry.set('deleted', true);
    expect(listAttachments(doc).map((a) => a.name)).toEqual(['pic.png']);
    await restoreBlobs(backup.manifest, backup.blobs!, fresh.of, () => doc);
    expect(listAttachments(doc).map((a) => a.name).sort()).toEqual(['note.txt', 'pic.png']);
  });

  it('skips a file whose bytes do not match the hash and says so', async () => {
    const { root, service, note } = await setup();
    const r = await service.run('manual', { force: true });
    if (r.status !== 'written') throw new Error('expected a backup');
    root.files.set(`acct1/blobs/${note.hash}`, new TextEncoder().encode('tampered'));
    const out = await restoreBlobs(r.manifest, folderBlobSource(new SubDir(root, 'acct1')), stores().of);
    expect(out).toEqual({ restored: 1, already: 0, unavailable: 1 });
  });
});

describe('files in encrypted folder backups', () => {
  it('names files by an HMAC, encrypts their bytes, writes no readable copy, and restores with the key', async () => {
    const { root, service, ring, note, img } = await setup({ encrypted: true });
    const r = await service.run('manual', { force: true });
    if (r.status !== 'written' || !ring) throw new Error('expected a backup');
    const names = [...root.files.keys()].filter((k) => k.startsWith('acct1/blobs/'));
    expect(names).toHaveLength(2);
    for (const n of names) {
      expect(n).not.toContain(note.hash);
      expect(n).not.toContain(img.hash);
      expect(new TextDecoder('latin1').decode((root.files.get(n) as Uint8Array).subarray(0, 6))).toBe('PDENC1');
    }
    expect([...root.files.keys()].some((k) => k.includes('attachments/'))).toBe(false);
    // The same passphrase names a file the same way, so a second device does not copy it again.
    await service.run('manual', { force: true });
    expect([...root.files.keys()].filter((k) => k.startsWith('acct1/blobs/'))).toHaveLength(2);

    const view = withKey(root, ring.key);
    const fresh = stores();
    const manifest = (await openBackup(new SubDir(view, 'acct1/current'))).manifest;
    const out = await restoreBlobs(manifest, accountBlobSource(view, 'acct1'), fresh.of);
    expect(out.restored).toBe(2);
    expect(await sha(new Uint8Array(await (await fresh.of('personal').get(img.hash))!.blob.arrayBuffer()))).toBe(img.hash);
  });
});

describe('downloads', () => {
  it('the zip carries the files and restores them; the JSON file says it leaves them out', async () => {
    const { service, note } = await setup();
    const zip = await service.downloadZip();
    expect(zip.manifest).toMatchObject({ blob_storage: 'zip' });
    const archive = await readZip(zip.blob);
    expect(archive.has(blobPath({ unit: 'personal', name: 'note.txt' }))).toBe(true);
    expect(archive.has('manifest.json')).toBe(true);
    const backup = await openBackup(new ZipDir(archive));
    expect(backup.verification.ok).toBe(true);
    const fresh = stores();
    expect((await restoreBlobs(backup.manifest, backup.blobs!, fresh.of)).restored).toBe(2);
    expect(await fresh.of('personal').get(note.hash)).toBeDefined();

    const json = await service.downloadable();
    expect(json.leftOut.count).toBe(2);
    expect(json.manifest.blob_storage).toBe('none');
    expect(json.text).not.toContain('hello files');
  });

  it('a snapshot without files has none', async () => {
    const store = memoryStore();
    seedSpace(await store.open('space/personal'), 'S');
    const snap = await createSnapshot(store.opened(), { deviceId: 'd', reason: 'x' });
    expect(snap.manifest).toMatchObject({ blobs: [], blob_storage: 'none', blobs_missing: 0 });
  });
});
