import * as Y from 'yjs';
import { isValidDocId } from '../core/doc-store';
import { MemoryDir, NotFoundError, isSafePath, type BackupDir } from './dir';
import {
  BUNDLE_FORMAT,
  blobPath,
  MANIFEST,
  base64,
  decodeText,
  encodeText,
  sha256Hex,
  unbase64,
  type Bundle,
  type Manifest,
} from './format';
import { readManifest } from './store';
import type { BlobSource } from './blobs';
import type { Snapshot } from './snapshot';

/** Transaction origin of updates applied by a restore. */
const RESTORE_ORIGIN = 'backup-restore';

interface Verification {
  ok: boolean;
  /** Files checked against their SHA-256. */
  checked: number;
  problems: string[];
}

export interface DocUpdate {
  id: string;
  update: Uint8Array;
}

export class BackupVerifyError extends Error {
  constructor(readonly problems: string[]) {
    super(`The backup failed verification: ${problems.slice(0, 3).join('; ')}${problems.length > 3 ? ` (and ${problems.length - 3} more)` : ''}`);
    this.name = 'BackupVerifyError';
  }
}

function sameStateVector(a: Map<number, number>, b: Map<number, number>): boolean {
  if (a.size !== b.size) return false;
  for (const [client, clock] of a) if (b.get(client) !== clock) return false;
  return true;
}

/**
 * Check a backup before anything is applied: every listed file exists with its size and SHA-256,
 * every document id and path is valid, and each document's update decodes to exactly the state
 * vector recorded in the manifest.
 */
async function verifyBackup(dir: BackupDir, manifest: Manifest): Promise<Verification> {
  const problems: string[] = [];
  let checked = 0;
  for (const [path, info] of Object.entries(manifest.files)) {
    if (!isSafePath(path)) {
      problems.push(`unsafe file path ${JSON.stringify(path)}`);
      continue;
    }
    let data: Uint8Array;
    try {
      data = await dir.readFile(path);
    } catch (e) {
      problems.push(e instanceof NotFoundError ? `${path} is missing` : `${path} could not be read`);
      continue;
    }
    checked++;
    if (data.byteLength !== info.bytes) problems.push(`${path} has ${data.byteLength} bytes, expected ${info.bytes}`);
    else if ((await sha256Hex(data)) !== info.sha256) problems.push(`${path} does not match its checksum`);
  }
  if (manifest.documents.length === 0) problems.push('the backup holds no documents');
  const ids = new Set<string>();
  for (const d of manifest.documents) {
    if (!isValidDocId(d.id)) problems.push(`invalid document id ${JSON.stringify(d.id)}`);
    if (ids.has(d.id)) problems.push(`document ${d.id} is listed twice`);
    ids.add(d.id);
    if (!manifest.files[d.update]) problems.push(`${d.id}: update file is not in the file list`);
    if (!manifest.files[d.state_vector]) problems.push(`${d.id}: state vector file is not in the file list`);
    if (problems.length > 0) continue;
    try {
      const update = await dir.readFile(d.update);
      const sv = await dir.readFile(d.state_vector);
      if (base64(sv) !== d.state_vector_base64) problems.push(`${d.id}: state vector file differs from the manifest`);
      const probe = new Y.Doc();
      Y.applyUpdate(probe, update);
      const decoded = Y.decodeStateVector(Y.encodeStateVector(probe));
      probe.destroy();
      // Structs Yjs cannot integrate stay pending and are missing from the state vector, so an
      // incomplete update fails this comparison.
      if (!sameStateVector(decoded, Y.decodeStateVector(sv))) problems.push(`${d.id}: update does not contain the recorded state`);
    } catch (e) {
      problems.push(`${d.id}: update could not be decoded (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return { ok: problems.length === 0, checked, problems };
}

/** The readable copies of the files inside a backup directory or zip (kept here so the file code loads only when files are backed up or restored). */
function dirBlobSource(dir: BackupDir): BlobSource {
  return {
    async read(b) {
      const path = blobPath(b);
      if (!isSafePath(path)) return undefined;
      try {
        return await dir.readFile(path);
      } catch (e) {
        if (e instanceof NotFoundError) return undefined;
        throw e;
      }
    },
  };
}

export interface OpenedBackup {
  dir: BackupDir;
  manifest: Manifest;
  verification: Verification;
  /** Where the bytes of `manifest.blobs` are; none for a JSON download, which leaves files out. */
  blobs?: BlobSource;
}

/**
 * Read and verify a backup folder (or an unpacked bundle or zip). Never throws for a damaged backup; check
 * `verification.ok`. The files in notes are read from `blobs` when given, else from the readable copies in the backup itself.
 */
export async function openBackup(dir: BackupDir, blobs?: BlobSource): Promise<OpenedBackup> {
  const manifest = await readManifest(dir);
  const source = blobs ?? (manifest.blob_storage === 'none' ? undefined : dirBlobSource(dir));
  return { dir, manifest, verification: await verifyBackup(dir, manifest), ...(source ? { blobs: source } : {}) };
}

/** The Yjs updates of a verified backup. */
export async function backupUpdates(backup: OpenedBackup): Promise<DocUpdate[]> {
  if (!backup.verification.ok) throw new BackupVerifyError(backup.verification.problems);
  const out: DocUpdate[] = [];
  for (const d of backup.manifest.documents) out.push({ id: d.id, update: await backup.dir.readFile(d.update) });
  return out;
}

/**
 * Merge a verified backup into the current documents: Yjs applies what is missing and keeps
 * everything local, so nothing on this device is lost. Edits made after the backup stay.
 */
export async function mergeBackup(backup: OpenedBackup, open: (id: string) => Promise<Y.Doc>): Promise<string[]> {
  const updates = await backupUpdates(backup);
  return applyUpdates(updates, open);
}

export async function applyUpdates(updates: DocUpdate[], open: (id: string) => Promise<Y.Doc>): Promise<string[]> {
  const done: string[] = [];
  for (const { id, update } of updates) {
    if (!isValidDocId(id)) throw new Error(`Invalid document id: ${id}`);
    const doc = await open(id);
    Y.applyUpdate(doc, update, RESTORE_ORIGIN);
    done.push(id);
  }
  return done;
}

const BINARY = /\.ybin$/;

/** A snapshot as a single JSON file (the download fallback when no folder can be picked). */
function snapshotToBundle(manifest: Manifest, files: ReadonlyMap<string, Uint8Array>): Bundle {
  const out: Bundle['files'] = {};
  for (const [path, data] of files) {
    if (path === MANIFEST) continue;
    if (BINARY.test(path)) out[path] = { base64: base64(data) };
    else {
      try {
        out[path] = { text: decodeText(data) };
      } catch {
        out[path] = { base64: base64(data) };
      }
    }
  }
  return { format: BUNDLE_FORMAT, bundle_version: 1, manifest, files: out };
}

export function bundleText(snap: Pick<Snapshot, 'manifest' | 'files'>): string {
  return JSON.stringify(snapshotToBundle(snap.manifest, snap.files));
}

/** Unpack a bundle into an in-memory folder that reads like a backup folder. */
export function bundleToDir(text: string): MemoryDir {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON, so it is not a backup file.');
  }
  const b = raw as Partial<Bundle>;
  if (!b || b.format !== BUNDLE_FORMAT || !b.manifest || !b.files || typeof b.files !== 'object') {
    throw new Error('The file is not a backup file.');
  }
  const dir = new MemoryDir();
  for (const [path, content] of Object.entries(b.files)) {
    if (!isSafePath(path) || path === MANIFEST) continue;
    const c = content as { text?: unknown; base64?: unknown };
    if (typeof c.text === 'string') dir.files.set(path, encodeText(c.text));
    else if (typeof c.base64 === 'string') dir.files.set(path, unbase64(c.base64));
  }
  dir.files.set(MANIFEST, encodeText(JSON.stringify(b.manifest)));
  return dir;
}

/** Copy a backup folder into memory (for the download of an existing backup). */
export async function readAllFiles(dir: BackupDir, manifest: Manifest): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const path of Object.keys(manifest.files)) out.set(path, await dir.readFile(path));
  return out;
}
