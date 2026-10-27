import * as Y from 'yjs';
import { MAX_FILE_BYTES, MAX_UNIT_BYTES, WARN_FRACTION, formatBytes } from './limits';
import { downscale, imageSize } from './images';
import { hasLocationData, sniffImage, type InlineImageType } from './sniff';
import { pieceHashes, pieceListHash } from './pieces';
import type { BlobStore } from './store';

/**
 * Files in notes (#166, docs/architecture.md "Files in notes"). The bytes are in a `BlobStore`; this module keeps
 * the `attachments` map of a unit's document (what exists, keyed by the SHA-256 of the bytes) and the
 * add flow: limits, naming, sniffing, the location-data notice.
 */

export interface Attachment {
  hash: string;
  name: string;
  size: number;
  /** MIME type of an inline image; `application/octet-stream` for everything else (never the declared type). */
  type: string;
  width?: number;
  height?: number;
  created_at: string;
  /** SHA-256 of the piece hashes (pieces.ts); absent on entries written before file transfer. */
  pieces?: string;
}

export function attachmentsMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>('attachments');
}

function read(hash: string, m: Y.Map<unknown>): Attachment | null {
  if (m.get('deleted') === true) return null;
  const name = m.get('name');
  if (typeof name !== 'string') return null;
  const num = (k: string): number | undefined => (typeof m.get(k) === 'number' ? (m.get(k) as number) : undefined);
  return {
    hash,
    name,
    size: num('size') ?? 0,
    type: typeof m.get('type') === 'string' ? (m.get('type') as string) : 'application/octet-stream',
    width: num('width'),
    height: num('height'),
    created_at: typeof m.get('created_at') === 'string' ? (m.get('created_at') as string) : '',
    ...(typeof m.get('pieces') === 'string' ? { pieces: m.get('pieces') as string } : {}),
  };
}

/** Live attachments. An absent map reads as empty, so no migration is needed (F39). */
export function listAttachments(doc: Y.Doc): Attachment[] {
  const out: Attachment[] = [];
  attachmentsMap(doc).forEach((m, hash) => {
    const a = read(hash, m);
    if (a) out.push(a);
  });
  return out;
}

/** The entry a `![[name]]` points to. Names compare case-insensitively; the earliest add wins a tie. */
export function findAttachment(doc: Y.Doc, name: string): Attachment | undefined {
  const want = name.trim().toLowerCase();
  return listAttachments(doc)
    .filter((a) => a.name.toLowerCase() === want)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.hash.localeCompare(b.hash))[0];
}

/** Is `name` shaped like a file (has an extension other than `.md`)? Decides whether a missing embed shows a file placeholder. */
export function looksLikeFile(name: string): boolean {
  const m = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return !!m && m[1]!.toLowerCase() !== 'md';
}

/** Characters that would break `![[name]]` or a file path become `-`. */
export function cleanFileName(raw: string): string {
  // eslint-disable-next-line no-control-regex
  const base = (raw.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f[\]|#^:*?"<>]/g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '');
  return base || 'file';
}

/** `photo.png` taken: `photo 2.png`, `photo 3.png`, … */
export function uniqueFileName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${stem} ${n}${ext}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Pasted images have no name: `Pasted image 20261020-153012.png`, as Obsidian names them. */
function pastedName(file: File, type: InlineImageType | null, now: Date): string {
  if (file.name && file.name !== 'image.png') return file.name;
  const ext = type ? type.slice(6).replace('jpeg', 'jpg') : 'bin';
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `Pasted image ${stamp}.${ext}`;
}

export interface AddOptions {
  /** Re-encode over-size PNG, JPEG and WebP and keep only the smaller copy ("Shrink large photos"). */
  shrink?: boolean;
  /** Ask the browser to keep stored data (`navigator.storage.persist`); defaults to the real call. */
  persist?: () => Promise<unknown>;
  /** Current browser quota, for the 80% warning; defaults to `navigator.storage.estimate()`. */
  estimate?: () => Promise<{ usage?: number; quota?: number } | undefined>;
  now?: Date;
}

export type AddResult =
  | { ok: true; attachment: Attachment; reused: boolean; notices: string[] }
  | { ok: false; error: string };

async function browserEstimate(): Promise<{ usage?: number; quota?: number } | undefined> {
  try {
    return await navigator.storage?.estimate?.();
  } catch {
    return undefined;
  }
}

async function requestPersist(): Promise<unknown> {
  try {
    return await navigator.storage?.persist?.();
  } catch {
    return undefined;
  }
}

/**
 * Add one file to a unit: refuse over the caps, hash, store the bytes, write the index entry.
 * Same bytes twice give one entry; a clash on the name with different bytes gets a ` 2` suffix.
 */
export async function addAttachment(doc: Y.Doc, store: BlobStore, file: File, o: AddOptions = {}): Promise<AddResult> {
  if (file.size > MAX_FILE_BYTES) return { ok: false, error: `“${file.name || 'This file'}” is ${formatBytes(file.size)}; the limit is ${formatBytes(MAX_FILE_BYTES)} per file.` };
  let bytes = new Uint8Array(await file.arrayBuffer());
  const inline = sniffImage(bytes);
  const notices: string[] = [];
  // Warn about location data before any re-encode: the original is what the user chose to add.
  const located = hasLocationData(bytes);
  let blob: Blob = new Blob([bytes], { type: inline ?? 'application/octet-stream' });
  let size: { width: number; height: number } | null = null;
  if (inline) {
    if (o.shrink && inline !== 'image/gif') {
      const smaller = await downscale(blob, inline);
      if (smaller && smaller.size < blob.size) {
        blob = smaller;
        bytes = new Uint8Array(await smaller.arrayBuffer());
      }
    }
    size = await imageSize(blob);
  }
  const hash = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (located) notices.push(`“${cleanFileName(file.name)}” contains location data. It was added unchanged; anyone who gets this file can read the position. Yak can only check common formats.`);

  const map = attachmentsMap(doc);
  const existing = map.get(hash);
  if (existing && existing.get('deleted') !== true) {
    const a = read(hash, existing);
    if (a) {
      if (!(await store.get(hash))) await store.put(hash, blob);
      return { ok: true, attachment: a, reused: true, notices };
    }
  }

  const held = await store.totalSize();
  if (held + blob.size > MAX_UNIT_BYTES) {
    return { ok: false, error: `This space already holds ${formatBytes(held)} of files; the limit is ${formatBytes(MAX_UNIT_BYTES)}. Nothing was added.` };
  }
  const est = await (o.estimate ?? browserEstimate)();
  const unitFull = (held + blob.size) / MAX_UNIT_BYTES >= WARN_FRACTION;
  const browserFull = est?.usage !== undefined && est.quota ? (est.usage + blob.size) / est.quota >= WARN_FRACTION : false;
  if (unitFull || browserFull) notices.push(`Files in this space are using over ${Math.round(WARN_FRACTION * 100)}% of the space available. Delete files you no longer need, or back them up.`);

  // Without this a browser under storage pressure may delete the files. Asked when the unit's first file is added.
  if (held === 0) await (o.persist ?? requestPersist)();
  await store.put(hash, blob);
  const taken = listAttachments(doc).map((a) => a.name);
  const name = uniqueFileName(cleanFileName(pastedName(file, inline, o.now ?? new Date())), taken);
  const created_at = (o.now ?? new Date()).toISOString();
  const pieces = await pieceListHash(await pieceHashes(new Uint8Array(await blob.arrayBuffer())));
  doc.transact(() => {
    const m = new Y.Map<unknown>();
    m.set('name', name);
    m.set('size', blob.size);
    m.set('type', inline ?? 'application/octet-stream');
    if (size) {
      m.set('width', size.width);
      m.set('height', size.height);
    }
    m.set('pieces', pieces);
    m.set('created_at', created_at);
    m.set('deleted', false);
    map.set(hash, m);
  });
  const attachment = read(hash, map.get(hash)!)!;
  return { ok: true, attachment, reused: false, notices };
}
