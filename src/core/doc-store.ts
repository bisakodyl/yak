import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { migrateDoc, watchTooNew, type MigrationLog } from './migrations';

export interface Persistence {
  whenLoaded: Promise<void>;
  destroy(): Promise<void>;
}

export type PersistFn = (dbName: string, doc: Y.Doc) => Persistence;

export const indexedDbPersistence: PersistFn = (dbName, doc) => {
  const p = new IndexeddbPersistence(dbName, doc);
  return { whenLoaded: p.whenSynced.then(() => undefined), destroy: () => p.destroy() };
};

const DOC_ID = /^[a-z0-9][a-z0-9/_-]{0,190}$/;

export function isValidDocId(id: string): boolean {
  return DOC_ID.test(id) && !id.includes('..') && !id.endsWith('/');
}

/** Name of the IndexedDB database holding a document (used by restore to clear a document). */
export function docDbName(id: string): string {
  return `${STORAGE_PREFIX}-doc-${id}`;
}

/** The document id of a space's main (shared) document: projects, clients, tags, notes. */
export function spaceDocId(spaceId: string): string {
  return `space/${spaceId}`;
}

/**
 * The document id of a space's private part: this account's `time_entries`, `project_rates` and,
 * later, private notes. Synced only to the account's own devices (docs/sync.md).
 */
export function privateDocId(spaceId: string): string {
  return `space/${spaceId}/private`;
}

/** A space's debug log document: syncs only between devices that keep the space. */
export function spaceLogDocId(spaceId: string): string {
  return `space/${spaceId}/log`;
}

/** A shared debug log document (account or space): not user data, so not backed up or recorded in history. */
export function isLogDoc(id: string): boolean {
  return /^(account|space)\/[a-z0-9]+\/log$/.test(id);
}

/** The space a document belongs to (`space/<id>` or `space/<id>/…`), or undefined. */
export function spaceOfDoc(docId: string): string | undefined {
  const m = /^space\/([^/]+)/.exec(docId);
  return m ? m[1] : undefined;
}

/**
 * Opens and keeps Yjs documents, one per document id, each persisted in its own IndexedDB
 * database. Every open document is synced with paired devices by the sync layer, which listens
 * for newly opened documents.
 */
export class DocumentStore {
  private readonly docs = new Map<string, Promise<Y.Doc>>();
  private readonly loaded = new Map<string, Y.Doc>();
  private readonly listeners = new Set<(id: string, doc: Y.Doc) => void>();
  private readonly newer = new Map<string, number>();
  private readonly newerListeners = new Set<(id: string, version: number) => void>();

  constructor(
    private readonly persist: PersistFn = indexedDbPersistence,
    private readonly log: MigrationLog = () => {},
  ) {}

  open(id: string): Promise<Y.Doc> {
    if (!isValidDocId(id)) return Promise.reject(new Error(`Invalid document id: ${id}`));
    const existing = this.docs.get(id);
    if (existing) return existing;
    const opening = (async () => {
      const doc = new Y.Doc();
      const persistence = this.persist(docDbName(id), doc);
      await persistence.whenLoaded;
      // Migrate before anyone (sync included) sees the document. A document written by a newer app
      // is left alone and marked, here and if its version arrives later by sync.
      migrateDoc(doc, id, undefined, (step, detail) => this.log(step, detail));
      watchTooNew(doc, (version) => {
        if (this.newer.get(id) === version) return;
        this.newer.set(id, version);
        for (const l of this.newerListeners) l(id, version);
      });
      this.loaded.set(id, doc);
      for (const l of this.listeners) l(id, doc);
      return doc;
    })();
    this.docs.set(id, opening);
    return opening;
  }

  /** Documents loaded so far. */
  opened(): ReadonlyMap<string, Y.Doc> {
    return this.loaded;
  }

  get(id: string): Y.Doc | undefined {
    return this.loaded.get(id);
  }

  /** The document was written by a newer app: nothing may be sent for it until this page reloads with the new app. */
  isTooNew(id: string): boolean {
    return this.newer.has(id);
  }

  onTooNew(listener: (id: string, version: number) => void): () => void {
    this.newerListeners.add(listener);
    return () => this.newerListeners.delete(listener);
  }

  onOpened(listener: (id: string, doc: Y.Doc) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
