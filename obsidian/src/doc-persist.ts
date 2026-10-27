import * as Y from 'yjs';
import type { PersistFn } from '../../src/core/doc-store';

/**
 * Keeps each document in a file of the plugin's folder, so the plugin starts with its notes and does
 * not read an empty copy as "every file was deleted". The whole state is written after a pause in
 * edits (documents here are notes: small).
 */

export interface BinaryStore {
  read(name: string): Promise<Uint8Array | null>;
  write(name: string, data: Uint8Array): Promise<void>;
  remove(name: string): Promise<void>;
}

const SAVE_DELAY_MS = 1000;

/** A file name for a database name (`app-doc-space/abc` has slashes). */
export function fileNameFor(dbName: string): string {
  return `${dbName.replace(/[^a-z0-9_-]/gi, '_')}.bin`;
}

/** Documents of a space's private part (time entries) are never held here. */
function isPrivate(dbName: string): boolean {
  return /\/private$/.test(dbName);
}

export function docPersistence(store: BinaryStore): { persist: PersistFn; flush(): Promise<void> } {
  const pending = new Set<() => Promise<void>>();
  const persist: PersistFn = (dbName, doc) => {
    if (isPrivate(dbName)) return { whenLoaded: Promise.resolve(), destroy: async () => undefined };
    const name = fileNameFor(dbName);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = async (): Promise<void> => {
      if (timer) clearTimeout(timer);
      timer = undefined;
      await store.write(name, Y.encodeStateAsUpdate(doc));
    };
    const whenLoaded = store.read(name).then((data) => {
      if (data) Y.applyUpdate(doc, data, 'persist');
      pending.add(save);
      doc.on('update', (_u: Uint8Array, origin: unknown) => {
        if (origin === 'persist') return;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => void save(), SAVE_DELAY_MS);
      });
    });
    return {
      whenLoaded,
      destroy: async () => {
        await save();
        pending.delete(save);
      },
    };
  };
  return { persist, flush: async () => void (await Promise.all([...pending].map((s) => s()))) };
}

/**
 * Documents kept in the browser's IndexedDB instead of the vault, so vault sync never copies them.
 * Files an earlier session left in the plugin folder are imported once, and removed at a later
 * load, when the database already holds the document: a failed write cannot lose them.
 */
export function indexedDbWithMigration(store: BinaryStore, idb: PersistFn): PersistFn {
  return (dbName, doc) => {
    if (isPrivate(dbName)) return { whenLoaded: Promise.resolve(), destroy: async () => undefined };
    const name = fileNameFor(dbName);
    const inner = idb(dbName, doc);
    const whenLoaded = inner.whenLoaded.then(async () => {
      const data = await store.read(name);
      if (!data) return;
      if (Y.encodeStateAsUpdate(doc).byteLength > Y.encodeStateAsUpdate(new Y.Doc()).byteLength) await store.remove(name);
      else Y.applyUpdate(doc, data, 'persist');
    });
    return { whenLoaded, destroy: () => inner.destroy() };
  };
}
