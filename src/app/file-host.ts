import type * as Y from 'yjs';
import type { DocumentStore } from '../core/doc-store';
import { attachmentsMap, listAttachments } from '../core/blobs/attachments';
import { blobStore, onBlobStored } from '../core/blobs/store';
import type { FileHost, WantedFile } from '../sync/file-transfer';

/**
 * What file transfer needs from the app (#166 slice 2): the indexed files of the spaces this device
 * keeps whose bytes are not here yet, newest first. Which peer may be sent which space's files is
 * the same rule as its documents (`allowsDoc`), passed in as `allow`.
 */
export function createFileHost(opts: {
  store: DocumentStore;
  keepsSpace(spaceId: string): boolean;
  allow(unit: string, peerId: string): boolean;
  log?(text: string): void;
}): FileHost {
  /** `unit/hash` of files known to be held, so the store is not asked again. */
  const held = new Set<string>();
  const listeners = new Set<() => void>();
  const fire = (): void => listeners.forEach((l) => l());
  const watched = new Set<string>();
  const watch = (id: string, doc: Y.Doc): void => {
    if (watched.has(id) || !/^space\/[^/]+$/.test(id)) return;
    watched.add(id);
    attachmentsMap(doc).observeDeep(fire);
  };
  onBlobStored((unit, hash) => held.add(`${unit}/${hash}`));

  return {
    store: (unit) => blobStore(unit),
    allow: opts.allow,
    ...(opts.log ? { log: opts.log } : {}),
    onChange(listener) {
      listeners.add(listener);
      for (const [id, doc] of opts.store.opened()) watch(id, doc);
      const stop = opts.store.onOpened((id, doc) => {
        watch(id, doc);
        fire();
      });
      return () => {
        listeners.delete(listener);
        stop();
      };
    },
    async wanted() {
      const out: (WantedFile & { created_at: string })[] = [];
      for (const [id, doc] of opts.store.opened()) {
        const m = /^space\/([^/]+)$/.exec(id);
        if (!m || !opts.keepsSpace(m[1]!)) continue;
        const unit = m[1]!;
        for (const a of listAttachments(doc)) {
          const k = `${unit}/${a.hash}`;
          if (held.has(k)) continue;
          if (await blobStore(unit).get(a.hash).catch(() => undefined)) {
            held.add(k);
            continue;
          }
          out.push({ unit, hash: a.hash, size: a.size, ...(a.pieces ? { pieces: a.pieces } : {}), created_at: a.created_at });
        }
      }
      return out.sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  };
}
