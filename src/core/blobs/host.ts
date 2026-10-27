import type * as Y from 'yjs';
import { DISPLAY_MAX_SIDE, formatBytes } from './limits';
import { addAttachment, findAttachment, looksLikeFile, type Attachment } from './attachments';
import { downscale } from './images';
import { readShrinkPhotos } from './options';
import { blobStore, onBlobStored, type BlobStore } from './store';
import type { InlineImageType } from './sniff';

/**
 * What the notes editor needs from the file store, so `src/notes` never touches IndexedDB or the
 * index directly. One host per open space.
 */

export type EmbedView =
  | { kind: 'image'; name: string; url: string; width?: number; height?: number; revoke(): void }
  | { kind: 'file'; name: string; size: number; url: string; revoke(): void }
  | { kind: 'missing'; name: string; reason: 'not-in-index' | 'no-bytes' };

export interface AttachmentHost {
  /** Is `name` something to show as a file (in the index, or shaped like a file name)? */
  claims(name: string): boolean;
  /** The index entry for `name` (a sync read; used to reserve space before the bytes load). */
  lookup(name: string): Attachment | undefined;
  /** Load what to show. The caller revokes the URL when its element goes away. */
  open(name: string): Promise<EmbedView>;
  /** Resolves when the bytes of `name` reach this device (received from a peer). */
  whenStored?(name: string): Promise<void>;
  /** Add files; returns the names to link and the messages to show. */
  add(files: File[]): Promise<{ names: string[]; notices: string[]; errors: string[] }>;
}

export function createAttachmentHost(doc: Y.Doc, unitId: string, store: BlobStore = blobStore(unitId)): AttachmentHost {
  return {
    claims: (name) => !!findAttachment(doc, name) || looksLikeFile(name),
    lookup: (name) => findAttachment(doc, name),
    async open(name) {
      const a = findAttachment(doc, name);
      if (!a) return { kind: 'missing', name, reason: 'not-in-index' };
      const rec = await store.get(a.hash);
      if (!rec) return { kind: 'missing', name, reason: 'no-bytes' };
      const inline = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(a.type);
      let blob = rec.blob;
      if (inline) {
        const long = Math.max(a.width ?? 0, a.height ?? 0);
        if (long > DISPLAY_MAX_SIDE && a.type !== 'image/gif') {
          let copy = await store.getDisplay(a.hash);
          if (!copy) {
            copy = (await downscale(rec.blob, a.type as InlineImageType)) ?? undefined;
            if (copy) await store.putDisplay(a.hash, copy);
          }
          if (copy) blob = copy;
        }
      } else {
        blob = new Blob([rec.blob], { type: 'application/octet-stream' });
      }
      const url = URL.createObjectURL(blob);
      const revoke = (): void => URL.revokeObjectURL(url);
      return inline ? { kind: 'image', name: a.name, url, width: a.width, height: a.height, revoke } : { kind: 'file', name: a.name, size: a.size, url, revoke };
    },
    whenStored(name) {
      const a = findAttachment(doc, name);
      if (!a) return new Promise<void>(() => undefined);
      return new Promise<void>((resolve) => {
        const stop = onBlobStored((unit, hash) => {
          if (unit === unitId && hash === a.hash) {
            stop();
            resolve();
          }
        });
      });
    },
    async add(files) {
      const names: string[] = [];
      const notices: string[] = [];
      const errors: string[] = [];
      const shrink = readShrinkPhotos();
      for (const file of files) {
        try {
          const r = await addAttachment(doc, store, file, { shrink });
          if (r.ok) {
            names.push(r.attachment.name);
            notices.push(...r.notices);
          } else errors.push(r.error);
        } catch {
          errors.push(`Could not add “${file.name || 'file'}” (${formatBytes(file.size)}). The browser may be out of storage.`);
        }
      }
      return { names, notices, errors };
    },
  };
}
