import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, updateRecord } from '../core/schema';
import { MemoryDir, SubDir } from './dir';
import { MANIFEST, decodeText, encodeText, partitionKey, unbase64, type Manifest } from './format';
import fixtureV1 from './fixtures/backup-format-1.json?raw';
import { BackupVerifyError, bundleText, bundleToDir, mergeBackup, openBackup, type OpenedBackup } from './restore';
import { createSnapshot } from './snapshot';
import { listBackups, writeBackup } from './store';
import { addEntry, addNote, docJSON, memoryStore, seedSpace, stateVector } from './testing';

const DEVICE = 'aaaabbbb-0000-4000-8000-000000000001';

async function seededStore() {
  const store = memoryStore();
  const personal = await store.open('space/personal');
  const work = await store.open('space/work');
  const extra = await store.open('space/work/notes/0d5e');
  const ids = { personal: seedSpace(personal, 'P'), work: seedSpace(work, 'W') };
  extra.getText('body').insert(0, 'A document below a space.');
  return { store, personal, work, extra, ids };
}

async function backupTo(root: MemoryDir, docs: ReadonlyMap<string, Y.Doc>, now = new Date('2026-10-15T12:00:00Z')): Promise<Manifest> {
  return writeBackup(root, await createSnapshot(docs, { deviceId: DEVICE, reason: 'manual', now }));
}

async function opened(root: MemoryDir, name: string): Promise<OpenedBackup> {
  return openBackup(new SubDir(root, name));
}

function expectSameDocs(restored: ReadonlyMap<string, Y.Doc>, original: ReadonlyMap<string, Y.Doc>): void {
  expect([...restored.keys()].sort()).toEqual([...original.keys()].sort());
  for (const [id, doc] of original) {
    const copy = restored.get(id) as Y.Doc;
    expect(docJSON(copy, doc), id).toEqual(docJSON(doc));
    expect(stateVector(copy), id).toEqual(stateVector(doc));
  }
}

describe('backup then restore into an empty store', () => {
  it('reproduces every document exactly: same JSON for every shared type, same state vector', async () => {
    const { store } = await seededStore();
    const root = new MemoryDir();
    const manifest = await backupTo(root, store.opened());

    const backup = await opened(root, manifest.name);
    expect(backup.verification).toEqual({ ok: true, checked: Object.keys(manifest.files).length, problems: [] });

    const empty = memoryStore();
    const merged = await mergeBackup(backup, (id) => empty.open(id));
    expect(merged.sort()).toEqual(['space/personal', 'space/work', 'space/work/notes/0d5e']);
    expectSameDocs(empty.opened(), store.opened());
  });

  it('round-trips through the single-file bundle the same way', async () => {
    const { store } = await seededStore();
    const snap = await createSnapshot(store.opened(), { deviceId: DEVICE, reason: 'download' });
    const dir = bundleToDir(bundleText(snap));
    const backup = await openBackup(dir);
    expect(backup.verification.ok).toBe(true);
    expect(backup.manifest).toEqual(snap.manifest);
    const empty = memoryStore();
    await mergeBackup(backup, (id) => empty.open(id));
    expectSameDocs(empty.opened(), store.opened());
  });

  it('keeps soft-deleted records deleted, in the restored documents and in the readable files', async () => {
    const { store, ids } = await seededStore();
    const root = new MemoryDir();
    const manifest = await backupTo(root, store.opened());
    const empty = memoryStore();
    await mergeBackup(await opened(root, manifest.name), (id) => empty.open(id));
    const doc = await empty.open('space/personal');
    expect(collection(doc, 'time_entries').get(ids.personal.e3 as string)?.get('deleted')).toBe(true);
    expect(collection(doc, 'projects').get(ids.personal.oldProject as string)?.get('deleted')).toBe(true);
    expect(collection(doc, 'notes').get(ids.personal.gone as string)?.get('deleted')).toBe(true);
    expect(collection(doc, 'time_entries').get(ids.personal.e2 as string)?.get('deleted')).toBe(false);

    const doc0 = manifest.documents.find((d) => d.id === 'space/personal');
    expect(doc0?.counts.time_entries).toEqual({ total: 4, deleted: 1 });
    expect(doc0?.counts.notes).toEqual({ total: 3, deleted: 1 });
    const october = decodeText(root.files.get(`${manifest.name}/docs/space~personal/time_entries/2026-10.jsonl`) as Uint8Array);
    const deletedLine = october.split('\n').filter(Boolean).map((l) => JSON.parse(l)).find((e) => e.id === ids.personal.e3);
    expect(deletedLine).toMatchObject({ deleted: true, description: 'P deleted entry' });
  });

  it('does not resurrect a record deleted after the backup when the backup is merged back', async () => {
    const { store, personal, ids } = await seededStore();
    const root = new MemoryDir();
    const manifest = await backupTo(root, store.opened());
    updateRecord(personal, 'time_entries', ids.personal.e2 as string, { deleted: true });
    await mergeBackup(await opened(root, manifest.name), (id) => store.open(id));
    expect(collection(personal, 'time_entries').get(ids.personal.e2 as string)?.get('deleted')).toBe(true);
  });
});

describe('readable exports', () => {
  it('writes time entries as JSON Lines per month, losslessly, with the scheme in the manifest', async () => {
    const { store, personal } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());
    expect(m.partition).toEqual({ scheme: 'monthly', field: 'start', timezone: 'UTC' });
    const doc = m.documents.find((d) => d.id === 'space/personal');
    const entryFiles = doc?.exports.filter((p) => p.includes('/time_entries/')) ?? [];
    expect(entryFiles).toEqual([
      'docs/space~personal/time_entries/2026-08.jsonl',
      'docs/space~personal/time_entries/2026-09.jsonl',
      'docs/space~personal/time_entries/2026-10.jsonl',
    ]);
    // Read the entries back using only the manifest's file list, as a restore of an older
    // backup with a different partition scheme would.
    const read: Record<string, unknown>[] = [];
    for (const f of entryFiles) {
      for (const line of decodeText(root.files.get(`${m.name}/${f}`) as Uint8Array).split('\n')) if (line) read.push(JSON.parse(line));
    }
    const live = collection(personal, 'time_entries').toJSON() as Record<string, Record<string, unknown>>;
    expect(Object.fromEntries(read.map(({ id, ...rest }) => [id, rest]))).toEqual(live);
    for (const e of read) expect(entryFiles).toContain(`docs/space~personal/time_entries/${partitionKey(e)}.jsonl`);
    expect(read.find((e) => e.stop === null)).toMatchObject({ description: 'P running', duration: 0 });
  });

  it('writes notes as Markdown at their path, an index, projects, clients, tags and settings', async () => {
    const { store, ids } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());
    const file = (p: string) => decodeText(root.files.get(`${m.name}/docs/space~work/${p}`) as Uint8Array);
    expect(file('notes/Projects/Acme.md')).toContain('# W note');
    expect(file('notes/projects/ACME (' + (ids.work.twin as string).slice(0, 8) + ').md')).toBe('Same path, other case.\n');
    expect(root.files.has(`${m.name}/docs/space~work/notes/Trash/Old.md`)).toBe(false);
    const index = JSON.parse(file('notes.json')) as { id: string; file: string | null; deleted: boolean }[];
    expect(index.find((n) => n.id === ids.work.gone)).toMatchObject({ deleted: true, file: null });
    expect(JSON.parse(file('projects.json'))).toHaveLength(2);
    expect(JSON.parse(file('clients.json'))[0]).toMatchObject({ name: 'W client' });
    expect(JSON.parse(file('tags.json'))[0]).toMatchObject({ name: 'deep-work' });
    expect(JSON.parse(file('settings.json'))).toEqual({ week_start: 'monday' });
    expect(JSON.parse(file('meta.json'))).toMatchObject({ schema_version: 1 });
  });

  it('lists every file with its checksum and records the state vector of each document', async () => {
    const { store } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());
    const written = [...root.files.keys()].filter((k) => k.startsWith(`${m.name}/`)).map((k) => k.slice(m.name.length + 1));
    expect(written.sort()).toEqual([...Object.keys(m.files), MANIFEST].sort());
    expect(m.device_id).toBe(DEVICE);
    expect(m.counts.time_entries).toEqual({ total: 8, deleted: 2 });
    for (const d of m.documents) expect(d.state_vector_base64.length).toBeGreaterThan(0);
  });
});

describe('restore merges with newer local edits', () => {
  it('keeps every local edit made after the backup and adds what was missing', async () => {
    const { store, personal, ids } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());

    // Newer local work: a new entry, an edited entry, an edited note, and a new note.
    const added = addEntry(personal, '2026-10-15T13:00:00Z', '2026-10-15T14:00:00Z', 'after the backup');
    updateRecord(personal, 'time_entries', ids.personal.e1 as string, { description: 'edited later' });
    const noteText = collection(personal, 'notes').get(ids.personal.note as string)?.get('text') as Y.Text;
    noteText.insert(noteText.length, 'Added after the backup.\n');
    addNote(personal, 'Later.md', 'later');
    const before = docJSON(personal);

    await mergeBackup(await opened(root, m.name), (id) => store.open(id));
    expect(docJSON(personal)).toEqual(before);
    expect(collection(personal, 'time_entries').get(added)?.get('description')).toBe('after the backup');
  });

  it('unions a backup with a device that has other data', async () => {
    const { store } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());

    const other = memoryStore();
    const otherPersonal = await other.open('space/personal');
    const mine = addEntry(otherPersonal, '2026-10-14T09:00:00Z', '2026-10-14T10:00:00Z', 'only on the other device');
    await mergeBackup(await opened(root, m.name), (id) => other.open(id));
    const entries = collection(otherPersonal, 'time_entries');
    expect(entries.get(mine)?.get('description')).toBe('only on the other device');
    expect(entries.size).toBe(5);
    const original = store.get('space/personal') as Y.Doc;
    for (const [id] of collection(original, 'time_entries')) expect(entries.has(id)).toBe(true);
  });

  it('replace (a fresh store loading the backup) drops edits made after the backup', async () => {
    const { store, personal } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());
    const snapshotJSON = docJSON(personal);
    addEntry(personal, '2026-10-15T13:00:00Z', '2026-10-15T14:00:00Z', 'after the backup');

    const fresh = memoryStore();
    await mergeBackup(await opened(root, m.name), (id) => fresh.open(id));
    expect(docJSON(fresh.get('space/personal') as Y.Doc, personal)).toEqual(snapshotJSON);
  });
});

describe('damaged backups are refused before anything is applied', () => {
  async function damaged(mutate: (root: MemoryDir, m: Manifest) => void | Promise<void>) {
    const { store } = await seededStore();
    const root = new MemoryDir();
    const m = await backupTo(root, store.opened());
    await mutate(root, m);
    return opened(root, m.name);
  }

  it('fails the checksum when a byte of a Yjs update changes, and leaves the target untouched', async () => {
    const backup = await damaged((root, m) => {
      const path = `${m.name}/docs/space~personal/update.ybin`;
      const bytes = root.files.get(path) as Uint8Array;
      bytes[bytes.length - 3] = (bytes[bytes.length - 3] as number) ^ 0xff;
      root.files.set(path, bytes);
    });
    expect(backup.verification.ok).toBe(false);
    expect(backup.verification.problems).toContain('docs/space~personal/update.ybin does not match its checksum');

    const target = memoryStore();
    const doc = await target.open('space/personal');
    await expect(mergeBackup(backup, (id) => target.open(id))).rejects.toBeInstanceOf(BackupVerifyError);
    expect(doc.share.size).toBe(0);
    expect(target.opened().size).toBe(1);
  });

  it('fails when a readable file is edited, truncated or missing', async () => {
    const edited = await damaged((root, m) => {
      root.files.set(`${m.name}/docs/space~work/notes/Projects/Acme.md`, encodeText('tampered'));
    });
    expect(edited.verification.problems.join()).toMatch(/Acme\.md has \d+ bytes/);
    const missing = await damaged((root, m) => {
      root.files.delete(`${m.name}/docs/space~work/projects.json`);
    });
    expect(missing.verification.problems).toContain('docs/space~work/projects.json is missing');
  });

  it('fails when the manifest state vector does not match the update', async () => {
    const backup = await damaged((root, m) => {
      const doc = m.documents[0] as Manifest['documents'][0];
      doc.state_vector_base64 = 'AA==';
      root.files.set(`${m.name}/${MANIFEST}`, encodeText(JSON.stringify(m)));
    });
    expect(backup.verification.ok).toBe(false);
    expect(backup.verification.problems.join()).toMatch(/state vector file differs/);
  });

  it('fails when the manifest names a path outside the backup or an invalid document id', async () => {
    const backup = await damaged((root, m) => {
      m.files['../escape.txt'] = { sha256: '0', bytes: 1 };
      (m.documents[0] as Manifest['documents'][0]).id = '../evil';
      root.files.set(`${m.name}/${MANIFEST}`, encodeText(JSON.stringify(m)));
    });
    expect(backup.verification.problems).toEqual(expect.arrayContaining(['unsafe file path "../escape.txt"', 'invalid document id "../evil"']));
  });

  it('rejects files that are not backup bundles', () => {
    expect(() => bundleToDir('not json')).toThrow(/not valid JSON/);
    expect(() => bundleToDir('{"format":"something"}')).toThrow(/not a backup file/);
  });
});

describe('the backup folder', () => {
  it('keeps every backup, never overwrites one, and lists the newest first', async () => {
    const { store, personal } = await seededStore();
    const root = new MemoryDir();
    const at = new Date('2026-10-15T12:00:00Z');
    const a = await backupTo(root, store.opened(), at);
    addEntry(personal, '2026-10-15T13:00:00Z', '2026-10-15T14:00:00Z', 'x');
    const b = await backupTo(root, store.opened(), at);
    const c = await backupTo(root, store.opened(), new Date('2026-10-15T13:00:00Z'));
    expect(b.name).toBe(`${a.name}-2`);
    // An interrupted backup: files but no manifest.
    await root.writeFile('2026-10-15T14-00-00-000Z_aaaabbbb/docs/space~work/update.ybin', new Uint8Array([1]));
    await root.writeFile('unrelated folder/file.txt', new Uint8Array([1]));
    const { items, total } = await listBackups(root);
    expect(total).toBe(4);
    expect(items.map((i) => i.name)).toEqual(['2026-10-15T14-00-00-000Z_aaaabbbb', c.name, b.name, a.name]);
    expect(items[0]?.error).toMatch(/Incomplete/);
    expect(items[1]?.manifest?.counts.time_entries.total).toBe(9);
    expect((await opened(root, a.name)).verification.ok).toBe(true);
  });
});

// A frozen backup written by format version 1. When the format changes, this file must keep
// restoring: it is the "backup made by an older format version" test. Regenerate only with
// UPDATE_BACKUP_FIXTURE=1, and never after format version 1 has shipped.

describe('a backup made by format version 1 (golden file)', () => {
  it.runIf(import.meta.env.UPDATE_BACKUP_FIXTURE === '1')('regenerates the fixture', async () => {
    const store = memoryStore();
    seedSpace(await store.open('space/personal'), 'Fixture');
    seedSpace(await store.open('space/work'), 'Fixture work');
    const snap = await createSnapshot(store.opened(), { deviceId: 'f1f1f1f1-0000-4000-8000-000000000000', reason: 'fixture', now: new Date('2026-10-15T00:00:00Z') });
    const fs = (await import(/* @vite-ignore */ `node:${'fs'}`)) as { writeFileSync(p: URL, s: string): void };
    fs.writeFileSync(new URL('./fixtures/backup-format-1.json', import.meta.url), `${JSON.stringify(JSON.parse(bundleText(snap)), null, 1)}\n`);
  });

  it('verifies and restores into an empty store with the recorded content', async () => {
    const backup = await openBackup(bundleToDir(fixtureV1));
    expect(backup.manifest.format_version).toBe(1);
    expect(backup.verification).toMatchObject({ ok: true, problems: [] });
    const store = memoryStore();
    await mergeBackup(backup, (id) => store.open(id));
    const personal = store.get('space/personal') as Y.Doc;
    const entries = Object.values(collection(personal, 'time_entries').toJSON()) as { description: string; deleted: boolean; stop: string | null }[];
    expect(entries.map((e) => e.description).sort()).toEqual(['Fixture September', 'Fixture deleted entry', 'Fixture late August', 'Fixture running']);
    expect(entries.find((e) => e.description === 'Fixture deleted entry')?.deleted).toBe(true);
    expect(entries.find((e) => e.description === 'Fixture running')?.stop).toBeNull();
    const notes = Object.values(collection(personal, 'notes').toJSON()) as { path: string; text: string }[];
    expect(notes.find((n) => n.path === 'Projects/Acme.md')?.text).toContain('# Fixture note');
    expect(personal.getMap('settings').get('week_start')).toBe('monday');
    for (const d of backup.manifest.documents) {
      const doc = store.get(d.id) as Y.Doc;
      expect(Y.encodeStateVector(doc)).toEqual(unbase64(d.state_vector_base64));
    }
  });
});
