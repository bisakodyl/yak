import { STORAGE_PREFIX } from '../../constants';
import type { Mark, NewSegment, Segment, SegmentStore } from './types';

const DB = `${STORAGE_PREFIX}-history`;
const SEGMENTS = 'segments';
const MARKS = 'marks';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/**
 * The change log in this device's IndexedDB database `<prefix>-history`: one object store of
 * segments keyed by `[docId, seq]` (so a document's log reads in order) and one of named versions.
 * Never synced and never part of a document.
 */
export class IdbStore implements SegmentStore {
  private db: Promise<IDBDatabase> | undefined;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const segments = db.createObjectStore(SEGMENTS, { keyPath: ['docId', 'seq'] });
        segments.createIndex('byDoc', 'docId');
        db.createObjectStore(MARKS, { keyPath: 'id' }).createIndex('byDoc', 'docId');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  async append(seg: NewSegment): Promise<Segment> {
    const db = await this.open();
    const tx = db.transaction(SEGMENTS, 'readwrite');
    const store = tx.objectStore(SEGMENTS);
    // The next seq is one past the last key of this document.
    const cursor = await request(store.openCursor(IDBKeyRange.bound([seg.docId, 0], [seg.docId, Number.MAX_SAFE_INTEGER]), 'prev'));
    const last = cursor ? (cursor.value as Segment).seq : 0;
    const full: Segment = { ...seg, seq: last + 1 };
    store.put(full);
    await done(tx);
    return full;
  }

  async list(docId: string): Promise<Segment[]> {
    const db = await this.open();
    const range = IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]);
    return request(db.transaction(SEGMENTS).objectStore(SEGMENTS).getAll(range));
  }

  async replace(docId: string, seqs: readonly number[], merged: NewSegment): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(SEGMENTS, 'readwrite');
    const store = tx.objectStore(SEGMENTS);
    const first = Math.min(...seqs);
    for (const seq of seqs) store.delete([docId, seq]);
    store.put({ ...merged, seq: first });
    await done(tx);
  }

  async docIds(): Promise<string[]> {
    const db = await this.open();
    const ids = new Set<string>();
    const cursor = db.transaction(SEGMENTS).objectStore(SEGMENTS).index('byDoc').openKeyCursor(null, 'nextunique');
    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        ids.add(String(c.key));
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    return [...ids];
  }

  async addMark(mark: Mark): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(MARKS, 'readwrite');
    tx.objectStore(MARKS).put(mark);
    await done(tx);
  }

  async marks(docId: string, noteId?: string): Promise<Mark[]> {
    const db = await this.open();
    const all = await request<Mark[]>(db.transaction(MARKS).objectStore(MARKS).index('byDoc').getAll(docId));
    return all.filter((m) => noteId === undefined || m.noteId === noteId).sort((a, b) => a.at - b.at);
  }

  async removeMark(id: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(MARKS, 'readwrite');
    tx.objectStore(MARKS).delete(id);
    await done(tx);
  }

  async removeDoc(docId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction([SEGMENTS, MARKS], 'readwrite');
    tx.objectStore(SEGMENTS).delete(IDBKeyRange.bound([docId, 0], [docId, Number.MAX_SAFE_INTEGER]));
    const marks = tx.objectStore(MARKS).index('byDoc');
    const cursor = marks.openKeyCursor(IDBKeyRange.only(docId));
    await new Promise<void>((resolve, reject) => {
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (!c) return resolve();
        tx.objectStore(MARKS).delete(c.primaryKey);
        c.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
    await done(tx);
  }
}
