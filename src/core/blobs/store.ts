/**
 * The bytes of attached files, outside Yjs: one IndexedDB database per unit (a space; later a
 * single-note share), key = SHA-256 hex of the bytes. The `attachments` map in the unit's document
 * says what exists; this says what is held on this device.
 */

export interface BlobRecord {
  blob: Blob;
  size: number;
  added_at: string;
}

export interface BlobStore {
  get(hash: string): Promise<BlobRecord | undefined>;
  /** Is the file held? Checks the key only, without loading the bytes. */
  has(hash: string): Promise<boolean>;
  put(hash: string, blob: Blob): Promise<void>;
  delete(hash: string): Promise<void>;
  /** Total bytes held. */
  totalSize(): Promise<number>;
  /** A device-local display copy of an inline image (never synced; rebuilt on demand). */
  getDisplay(hash: string): Promise<Blob | undefined>;
  putDisplay(hash: string, blob: Blob): Promise<void>;
  /** Verified pieces of a file still being received (index → bytes); kept so a dropped link resumes. */
  getPieces(hash: string): Promise<Map<number, Uint8Array>>;
  putPiece(hash: string, index: number, bytes: Uint8Array): Promise<void>;
  deletePieces(hash: string): Promise<void>;
}

type StoredListener = (unitId: string, hash: string) => void;
const storedListeners = new Set<StoredListener>();
/** Bytes of a file reached this device (received from a peer). The editor swaps its placeholder for the file. */
export function onBlobStored(listener: StoredListener): () => void {
  storedListeners.add(listener);
  return () => storedListeners.delete(listener);
}
export function announceBlobStored(unitId: string, hash: string): void {
  for (const l of [...storedListeners]) l(unitId, hash);
}

export const blobDbName = (unitId: string): string => `app-blobs-${unitId}`;

export class MemoryBlobStore implements BlobStore {
  readonly files = new Map<string, BlobRecord>();
  readonly display = new Map<string, Blob>();
  readonly pieces = new Map<string, Map<number, Uint8Array>>();
  async get(hash: string): Promise<BlobRecord | undefined> {
    return this.files.get(hash);
  }
  async has(hash: string): Promise<boolean> {
    return this.files.has(hash);
  }
  async put(hash: string, blob: Blob): Promise<void> {
    this.files.set(hash, { blob, size: blob.size, added_at: new Date().toISOString() });
  }
  async delete(hash: string): Promise<void> {
    this.files.delete(hash);
    this.display.delete(hash);
  }
  async getPieces(hash: string): Promise<Map<number, Uint8Array>> {
    return new Map(this.pieces.get(hash));
  }
  async putPiece(hash: string, index: number, bytes: Uint8Array): Promise<void> {
    const m = this.pieces.get(hash) ?? new Map<number, Uint8Array>();
    m.set(index, bytes);
    this.pieces.set(hash, m);
  }
  async deletePieces(hash: string): Promise<void> {
    this.pieces.delete(hash);
  }
  async totalSize(): Promise<number> {
    let n = 0;
    for (const r of this.files.values()) n += r.size;
    return n;
  }
  async getDisplay(hash: string): Promise<Blob | undefined> {
    return this.display.get(hash);
  }
  async putDisplay(hash: string, blob: Blob): Promise<void> {
    this.display.set(hash, blob);
  }
}

const FILES = 'files';
const DISPLAY = 'display';
const PIECES = 'pieces';

export class IdbBlobStore implements BlobStore {
  private db: Promise<IDBDatabase> | undefined;
  constructor(private readonly name: string) {}

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, 2);
      req.onupgradeneeded = () => {
        // Version 2 adds the pieces of partial downloads; an older database keeps its files.
        for (const n of [FILES, DISPLAY, PIECES]) if (!req.result.objectStoreNames.contains(n)) req.result.createObjectStore(n);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return this.db;
  }

  private async run<T>(store: string, mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const req = f(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  get(hash: string): Promise<BlobRecord | undefined> {
    return this.run<BlobRecord | undefined>(FILES, 'readonly', (s) => s.get(hash));
  }
  async has(hash: string): Promise<boolean> {
    return (await this.run<number>(FILES, 'readonly', (s) => s.count(hash))) > 0;
  }
  async put(hash: string, blob: Blob): Promise<void> {
    const rec: BlobRecord = { blob, size: blob.size, added_at: new Date().toISOString() };
    await this.run(FILES, 'readwrite', (s) => s.put(rec, hash));
  }
  async getPieces(hash: string): Promise<Map<number, Uint8Array>> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const out = new Map<number, Uint8Array>();
      const tx = db.transaction(PIECES, 'readonly');
      const req = tx.objectStore(PIECES).openCursor(IDBKeyRange.bound(`${hash}:`, `${hash}:\uffff`));
      req.onsuccess = () => {
        const c = req.result;
        if (!c) return;
        out.set(Number(String(c.key).slice(hash.length + 1)), c.value as Uint8Array);
        c.continue();
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }
  async putPiece(hash: string, index: number, bytes: Uint8Array): Promise<void> {
    await this.run(PIECES, 'readwrite', (s) => s.put(bytes, `${hash}:${index}`));
  }
  async deletePieces(hash: string): Promise<void> {
    await this.run(PIECES, 'readwrite', (s) => s.delete(IDBKeyRange.bound(`${hash}:`, `${hash}:\uffff`)));
  }
  async delete(hash: string): Promise<void> {
    await this.run(FILES, 'readwrite', (s) => s.delete(hash));
    await this.run(DISPLAY, 'readwrite', (s) => s.delete(hash));
  }
  async totalSize(): Promise<number> {
    const all = await this.run<BlobRecord[]>(FILES, 'readonly', (s) => s.getAll());
    return all.reduce((n, r) => n + r.size, 0);
  }
  getDisplay(hash: string): Promise<Blob | undefined> {
    return this.run<Blob | undefined>(DISPLAY, 'readonly', (s) => s.get(hash));
  }
  async putDisplay(hash: string, blob: Blob): Promise<void> {
    await this.run(DISPLAY, 'readwrite', (s) => s.put(blob, hash));
  }
}

const open = new Map<string, BlobStore>();

/** The store of a unit on this device; one instance per unit. */
export function blobStore(unitId: string): BlobStore {
  let s = open.get(unitId);
  if (!s) {
    s = new IdbBlobStore(blobDbName(unitId));
    open.set(unitId, s);
  }
  return s;
}
