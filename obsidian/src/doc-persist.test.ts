import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { PersistFn } from '../../src/core/doc-store';
import { DocumentStore } from '../../src/core/doc-store';
import { docPersistence, fileNameFor, indexedDbWithMigration, type BinaryStore } from './doc-persist';

function memoryStore(): BinaryStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return { files, read: async (n) => files.get(n) ?? null, write: async (n, d) => void files.set(n, d.slice()), remove: async (n) => void files.delete(n) };
}

describe('document persistence', () => {
  it('saves a document and loads it in the next session', async () => {
    const disk = memoryStore();
    const first = docPersistence(disk);
    const store = new DocumentStore(first.persist);
    const doc = await store.open('space/abc');
    doc.getMap('notes').set('k', 'v');
    await first.flush();
    expect([...disk.files.keys()]).toEqual([fileNameFor('app-doc-space/abc')]);

    const second = new DocumentStore(docPersistence(disk).persist);
    expect((await second.open('space/abc')).getMap('notes').get('k')).toBe('v');
  });

  it('never keeps a private part', async () => {
    const disk = memoryStore();
    const p = docPersistence(disk);
    const store = new DocumentStore(p.persist);
    (await store.open('space/abc/private')).getMap('time_entries').set('k', 'v');
    await p.flush();
    expect(disk.files.size).toBe(0);
  });

  it('does not write back what it just loaded', async () => {
    const disk = memoryStore();
    const seed = new Y.Doc();
    seed.getMap('m').set('a', 1);
    disk.files.set(fileNameFor('app-doc-account/x'), Y.encodeStateAsUpdate(seed));
    const store = new DocumentStore(docPersistence(disk).persist);
    expect((await store.open('account/x')).getMap('m').get('a')).toBe(1);
  });
});

describe('documents kept out of the vault', () => {
  /** A stand-in for IndexedDB: one saved state per database name, shared by sessions. */
  function fakeIdb(saved: Map<string, Uint8Array>): PersistFn {
    return (name, doc) => {
      const data = saved.get(name);
      if (data) Y.applyUpdate(doc, data, 'idb');
      doc.on('update', (_u: Uint8Array, origin: unknown) => {
        if (origin !== 'idb') saved.set(name, Y.encodeStateAsUpdate(doc));
      });
      return { whenLoaded: Promise.resolve(), destroy: async () => undefined };
    };
  }

  it('writes no file to the vault', async () => {
    const disk = memoryStore();
    const store = new DocumentStore(indexedDbWithMigration(disk, fakeIdb(new Map())));
    (await store.open('space/abc')).getMap('notes').set('k', 'v');
    expect(disk.files.size).toBe(0);
  });

  it('imports files from an earlier session, then removes them once the database has the document', async () => {
    const disk = memoryStore();
    const seed = new Y.Doc();
    seed.getMap('notes').set('k', 'v');
    disk.files.set(fileNameFor('app-doc-space/abc'), Y.encodeStateAsUpdate(seed));
    const saved = new Map<string, Uint8Array>();

    const first = new DocumentStore(indexedDbWithMigration(disk, fakeIdb(saved)));
    expect((await first.open('space/abc')).getMap('notes').get('k')).toBe('v');
    expect(disk.files.size).toBe(1);
    expect(saved.size).toBe(1);

    const second = new DocumentStore(indexedDbWithMigration(disk, fakeIdb(saved)));
    expect((await second.open('space/abc')).getMap('notes').get('k')).toBe('v');
    expect(disk.files.size).toBe(0);
  });

  it('never keeps a private part', async () => {
    const saved = new Map<string, Uint8Array>();
    const store = new DocumentStore(indexedDbWithMigration(memoryStore(), fakeIdb(saved)));
    (await store.open('space/abc/private')).getMap('time_entries').set('k', 'v');
    expect(saved.size).toBe(0);
  });
});
