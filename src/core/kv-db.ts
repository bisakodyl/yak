/**
 * A small key-value store in its own IndexedDB database, for per-device data that cannot live in
 * `localStorage` (folder handles) and never belongs in a synced document.
 */
export interface KvDb {
  kvGet<T>(key: string): Promise<T | undefined>;
  /** `undefined` deletes the key. */
  kvSet(key: string, value: unknown): Promise<void>;
}

const STORE = 'kv';

export function kvDb(dbName: string): KvDb {
  function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  return {
    async kvGet<T>(key: string): Promise<T | undefined> {
      const db = await open();
      try {
        return await new Promise<T | undefined>((resolve, reject) => {
          const req = db.transaction(STORE).objectStore(STORE).get(key);
          req.onsuccess = () => resolve(req.result as T | undefined);
          req.onerror = () => reject(req.error);
        });
      } finally {
        db.close();
      }
    },

    async kvSet(key: string, value: unknown): Promise<void> {
      const db = await open();
      try {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORE, 'readwrite');
          if (value === undefined) tx.objectStore(STORE).delete(key);
          else tx.objectStore(STORE).put(value, key);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
        });
      } finally {
        db.close();
      }
    },
  };
}
