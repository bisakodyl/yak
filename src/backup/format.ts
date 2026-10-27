import { base64, base64url, decodeText, encodeText, unbase64, unbase64url } from '../core/bytes';

export { base64, base64url, decodeText, encodeText, unbase64, unbase64url };

/**
 * The on-disk backup format. Layout of one backup folder (see docs/backups.md):
 *
 *   <backup folder>/
 *     manifest.json                         written last; a folder without it is incomplete
 *     docs/<doc folder>/update.ybin         Y.encodeStateAsUpdate: everything, the restore input
 *     docs/<doc folder>/state-vector.ybin   Y.encodeStateVector: what the update contains
 *     docs/<doc folder>/time_entries/<YYYY-MM>.jsonl
 *     docs/<doc folder>/projects.json, clients.json, tags.json, notes.json, settings.json, meta.json
 *     docs/<doc folder>/notes/<note path>.md
 *     docs/<doc folder>/attachments/<file name>   readable copies of the files (readable backups only)
 *
 * `<doc folder>` is the document id with `/` replaced by `~` (`space/work` → `space~work`).
 */

/** Bump when the layout or manifest changes; add an upgrade in `upgradeManifest`. */
export const FORMAT_VERSION = 2;
export const MANIFEST = 'manifest.json';
export const BUNDLE_FORMAT = 'backup-bundle';

export interface PartitionScheme {
  /** Period of one time-entry file. */
  scheme: 'monthly';
  /** The entry field that decides the period: an entry belongs to the period it started in. */
  field: 'start';
  timezone: 'UTC';
}

export const PARTITION: PartitionScheme = { scheme: 'monthly', field: 'start', timezone: 'UTC' };

export interface FileInfo {
  sha256: string;
  bytes: number;
}

/** One attached file (#166) a backup carries: the bytes are found by `hash`, in the account's `blobs/` folder or at `blobPath` in a zip. */
export interface BackupBlob {
  /** The space the file belongs to. */
  unit: string;
  hash: string;
  name: string;
  size: number;
  /** `image/png`, `image/jpeg`, `image/webp`, `image/gif` for inline images; `application/octet-stream` otherwise. */
  type: string;
}

/** Where the bytes of `manifest.blobs` are: next to the backups, in the zip itself, or nowhere (the JSON download). */
export type BlobStorage = 'folder' | 'zip' | 'none';

/** Readable path of an attached file inside a backup folder or zip, beside the notes of its space. */
export function blobPath(b: Pick<BackupBlob, 'unit' | 'name'>): string {
  return `${docFolder(`space/${b.unit}`)}/attachments/${safeSegment(b.name)}`;
}

interface RecordCount {
  total: number;
  deleted: number;
}

export interface DocCounts {
  time_entries: RecordCount;
  projects: RecordCount;
  clients: RecordCount;
  tags: RecordCount;
  notes: RecordCount;
}

export interface ManifestDoc {
  id: string;
  folder: string;
  /** Path of the Yjs update (the restore input). */
  update: string;
  /** Path of the encoded state vector. */
  state_vector: string;
  /** The same state vector, base64, so the manifest alone says what the backup contains. */
  state_vector_base64: string;
  counts: DocCounts;
  /** Human-readable export files of this document. */
  exports: string[];
}

export interface Manifest {
  format: 'backup';
  format_version: number;
  app: string;
  /** Folder name of this backup. */
  name: string;
  created_at: string;
  device_id: string;
  reason: string;
  partition: PartitionScheme;
  documents: ManifestDoc[];
  /** Every file of the backup except the manifest, with its SHA-256 and size. */
  files: Record<string, FileInfo>;
  counts: DocCounts;
  /** Files in notes whose bytes this backup carries (format 2; empty in older backups). */
  blobs: BackupBlob[];
  blob_storage: BlobStorage;
  /** Files the notes list that this device did not hold yet, so they are not in the backup. */
  blobs_missing: number;
}

/** A whole backup as one JSON file (the download fallback). Same manifest, same checksums. */
export interface Bundle {
  format: typeof BUNDLE_FORMAT;
  bundle_version: 1;
  manifest: Manifest;
  /** File contents: `{ text }` for UTF-8 files, `{ base64 }` for binary ones. */
  files: Record<string, { text: string } | { base64: string }>;
}

/**
 * The time-entry partition: the UTC month the entry started in, `YYYY-MM`. Entries without a
 * readable start go to `undated`. Change the period here (and `PARTITION`) only; callers and
 * restores read the file list from the manifest.
 */
export function partitionKey(entry: { start?: unknown }): string {
  const t = typeof entry.start === 'string' ? Date.parse(entry.start) : NaN;
  if (Number.isNaN(t)) return 'undated';
  return new Date(t).toISOString().slice(0, 7);
}

/** Folder name of a document inside a backup: `/` becomes `~`, which a document id never contains. */
export function docFolder(docId: string): string {
  return `docs/${docId.replaceAll('/', '~')}`;
}

/** Sortable backup folder name: `2026-10-15T19-26-15-123Z_ab12cd34` (UTC time, device prefix). */
export function backupName(date: Date, deviceId: string): string {
  const stamp = date.toISOString().replaceAll(':', '-').replace('.', '-');
  const dev = deviceId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8) || 'device';
  return `${stamp}_${dev}`;
}

export const BACKUP_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z_[a-zA-Z0-9]{1,8}(-\d+)?$/;

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i;

/** One path segment that is valid on Windows, macOS and Linux and in the File System Access API. */
export function safeSegment(s: string): string {
  let out = s
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '_')
    .replace(/[. ]+$/, '')
    .trim();
  if (out.length > 120) out = out.slice(0, 120).trim();
  if (out === '' || out === '.' || out === '..') out = '_';
  if (WINDOWS_RESERVED.test(out)) out = `_${out}`;
  return out;
}

/**
 * File path for a note inside `notes/`, from its `path` field: each segment made safe, `.md`
 * added when missing. `taken` holds lower-cased paths already used (case-insensitive file
 * systems); a clash gets the note id appended.
 */
export function notePath(path: string, id: string, taken: Set<string>): string {
  const segs = String(path || 'Untitled')
    .split(/[\\/]+/)
    .filter((s) => s.trim().length > 0)
    .map(safeSegment);
  if (segs.length === 0) segs.push('Untitled');
  let last = segs.pop() as string;
  if (!/\.md$/i.test(last)) last = `${last}.md`;
  let candidate = [...segs, last].join('/');
  if (taken.has(candidate.toLowerCase())) {
    candidate = [...segs, `${last.replace(/\.md$/i, '')} (${safeSegment(id).slice(0, 8)}).md`].join('/');
    let n = 2;
    while (taken.has(candidate.toLowerCase())) candidate = [...segs, `${last.replace(/\.md$/i, '')} (${safeSegment(id)}-${n++}).md`].join('/');
  }
  taken.add(candidate.toLowerCase());
  return candidate;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}


export function emptyCounts(): DocCounts {
  return {
    time_entries: { total: 0, deleted: 0 },
    projects: { total: 0, deleted: 0 },
    clients: { total: 0, deleted: 0 },
    tags: { total: 0, deleted: 0 },
    notes: { total: 0, deleted: 0 },
  };
}

export function addCounts(a: DocCounts, b: DocCounts): DocCounts {
  const out = emptyCounts();
  for (const k of Object.keys(out) as (keyof DocCounts)[]) {
    out[k] = { total: a[k].total + b[k].total, deleted: a[k].deleted + b[k].deleted };
  }
  return out;
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupFormatError';
  }
}

/**
 * Check a parsed manifest and bring an older format version up to the current shape. Rejects a
 * newer version (made by a newer app) instead of guessing.
 */
export function upgradeManifest(raw: unknown): Manifest {
  if (!raw || typeof raw !== 'object') throw new BackupFormatError('manifest.json is not a JSON object');
  const m = raw as Record<string, unknown>;
  if (m.format !== 'backup') throw new BackupFormatError('manifest.json is not a backup manifest');
  const version = m.format_version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
    throw new BackupFormatError(`Unknown backup format version: ${String(version)}`);
  }
  if (version > FORMAT_VERSION) {
    throw new BackupFormatError(
      `This backup was made by a newer version of the app (format ${version}; this app reads up to ${FORMAT_VERSION}). Update the app, then restore.`,
    );
  }
  // Upgrades from older versions go here, one step per version.
  // Version 1 -> 2 added files in notes (`blobs`, `blob_storage`, `blobs_missing`): a version 1
  // backup carries none, so the defaults below are its exact meaning. Fields that later versions
  // may omit get their defaults here, so an older backup still reads.
  const manifest = { ...m } as unknown as Manifest;
  manifest.blobs = Array.isArray(m.blobs) ? (m.blobs as BackupBlob[]) : [];
  manifest.blob_storage = m.blob_storage === 'folder' || m.blob_storage === 'zip' ? m.blob_storage : 'none';
  manifest.blobs_missing = typeof m.blobs_missing === 'number' ? m.blobs_missing : 0;
  manifest.partition ??= PARTITION;
  manifest.reason ??= 'unknown';
  manifest.app ??= '';
  if (!Array.isArray(manifest.documents)) throw new BackupFormatError('manifest.json has no document list');
  if (!manifest.files || typeof manifest.files !== 'object') throw new BackupFormatError('manifest.json has no file list');
  manifest.counts ??= manifest.documents.reduce((acc, d) => addCounts(acc, d.counts ?? emptyCounts()), emptyCounts());
  return manifest;
}
