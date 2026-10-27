import type * as Y from 'yjs';
import type { DocumentStore } from '../core/doc-store';
import { attachmentsMap } from '../core/blobs/attachments';
import { blobStore } from '../core/blobs/store';

/**
 * A file deleted in a space (Settings, or the mirror folder) is deleted for everyone: when this device sees
 * the index entry marked deleted, it drops the bytes (#166 slice 5). Nothing else removes bytes.
 */
export function startFileSweep(store: DocumentStore): () => void {
  const watched = new Set<string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sweep = (id: string, doc: Y.Doc): void => {
    const unit = /^space\/([^/]+)$/.exec(id)?.[1];
    if (!unit) return;
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => void import('../core/blobs/unused').then((m) => m.dropDeletedBytes(doc, blobStore(unit))).catch(() => undefined), 500),
    );
  };
  const watch = (id: string, doc: Y.Doc): void => {
    if (watched.has(id) || !/^space\/[^/]+$/.test(id)) return;
    watched.add(id);
    attachmentsMap(doc).observeDeep(() => sweep(id, doc));
    sweep(id, doc);
  };
  for (const [id, doc] of store.opened()) watch(id, doc);
  return store.onOpened(watch);
}
