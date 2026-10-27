import * as Y from 'yjs';
import { isLogDoc, isValidDocId } from '../core/doc-store';
import type { Segment, SegmentStore } from '../core/history/types';
import { MemoryDir, SubDir, type BackupDir } from './dir';
import { ENCRYPTION_FILE, EncryptedError } from './crypto';
import type { ReadBlob } from './blobs';
import { MANIFEST, decodeText, encodeText, sha256Hex, type FileInfo, type Manifest } from './format';
import type { Snapshot } from './snapshot';
import { listBackups, readManifest, writeBackup } from './store';
import { openBackup } from './restore';

/**
 * Incremental backups (docs/backups.md, decisions B12-B17). Inside the chosen folder, per account:
 *
 *   <account>/current/               readable mirror and latest full state, rewritten in place
 *   <account>/history/<doc>/<start>_<end>_<hash>.seg   segments of this device's change log
 *   <account>/restore-points/<name>/ full backups (the ordinary backup format), thinned
 *   <account>/manifest.json          index, written last
 */

export const CURRENT = 'current';
const HISTORY = 'history';
export const RESTORE_POINTS = 'restore-points';
const INDEX_FORMAT = 'backup-index';
const WEEK = 7 * 86_400_000;
const pad = (n: number): string => String(n).padStart(13, '0');

export interface BackupIndex {
  format: typeof INDEX_FORMAT;
  format_version: 1;
  account: string;
  updated_at: string;
  device_id: string;
  current: string;
  restore_points: string[];
  /** Every segment file this folder holds, by path relative to the account folder. */
  segments: Record<string, FileInfo>;
}

// ---- Segment files

interface SegHeader {
  v: 1;
  doc: string;
  start: number;
  end: number;
  baseline: boolean;
}

/** A segment as a file: one JSON header line, then the Yjs update. The name carries the hash of the whole file. */
export async function encodeSegment(s: Pick<Segment, 'docId' | 'start' | 'end' | 'baseline' | 'update'>): Promise<{ name: string; data: Uint8Array }> {
  const head = encodeText(`${JSON.stringify({ v: 1, doc: s.docId, start: s.start, end: s.end, baseline: s.baseline } satisfies SegHeader)}\n`);
  const data = new Uint8Array(head.length + s.update.length);
  data.set(head);
  data.set(s.update, head.length);
  return { name: `${pad(s.start)}_${pad(s.end)}_${(await sha256Hex(data)).slice(0, 16)}.seg`, data };
}

export function decodeSegment(data: Uint8Array): { header: SegHeader; update: Uint8Array } {
  const nl = data.indexOf(10);
  if (nl < 0) throw new Error('not a segment file');
  const header = JSON.parse(decodeText(data.subarray(0, nl))) as SegHeader;
  if (header.v !== 1 || typeof header.doc !== 'string') throw new Error('unknown segment format');
  return { header, update: data.subarray(nl + 1) };
}

const segmentFolder = (docId: string): string => `${HISTORY}/${docId.replaceAll('/', '~')}`;

/** Copy the segments of `docIds` that the folder lacks. Returns the new files and what the folder already had. */
export async function copySegments(
  store: SegmentStore,
  docIds: readonly string[],
  acct: BackupDir,
): Promise<{ written: Record<string, FileInfo>; present: number }> {
  const written: Record<string, FileInfo> = {};
  let present = 0;
  for (const id of docIds) {
    const folder = segmentFolder(id);
    const have = new Set(await acct.listFiles(folder));
    for (const seg of await store.list(id)) {
      const { name, data } = await encodeSegment(seg);
      if (have.has(name)) {
        present++;
        continue;
      }
      await acct.writeFile(`${folder}/${name}`, data);
      have.add(name);
      written[`${folder}/${name}`] = { sha256: await sha256Hex(data), bytes: data.byteLength };
    }
  }
  return { written, present };
}

// ---- The readable mirror

/** Rewrite `current/` so it equals the snapshot: only changed files are written, files gone from the data are removed. */
export async function writeCurrent(acct: BackupDir, snap: Snapshot, rewriteAll = false, files?: { read: ReadBlob }): Promise<{ written: number; kept: number }> {
  const dir = new SubDir(acct, CURRENT);
  let old: Manifest | undefined;
  try {
    old = await readManifest(dir);
  } catch {
    old = undefined;
  }
  let written = 0;
  let kept = 0;
  for (const [path, data] of snap.files) {
    const info = snap.manifest.files[path] as FileInfo;
    if (!rewriteAll && old?.files[path]?.sha256 === info.sha256 && (await dir.exists(path))) {
      kept++;
      continue;
    }
    await dir.writeFile(path, data);
    const back = await dir.readFile(path);
    if (back.byteLength !== info.bytes || (await sha256Hex(back)) !== info.sha256) throw new Error(`${path} did not read back as written`);
    written++;
  }
  // Without `files` (encrypted mode) no readable copy may stay behind, as with the other exports.
  const { writeReadableFiles } = await import('./blobs');
  await writeReadableFiles(dir, files ? snap.manifest.blobs : [], old, files?.read, rewriteAll);
  await dir.writeFile(MANIFEST, encodeText(`${JSON.stringify(snap.manifest, null, 2)}\n`));
  for (const path of Object.keys(old?.files ?? {})) if (!(path in snap.files) && !snap.manifest.files[path]) await dir.removeFile?.(path);
  return { written, kept };
}

// ---- Restore points

/** A restore point is due when none exists or the newest is a week old. */
export function restorePointDue(newest: string | undefined, now: number): boolean {
  if (!newest) return true;
  const t = Date.parse(newest);
  return Number.isNaN(t) || now - t >= WEEK;
}

/**
 * Which restore points to delete: the newest of each week for 4 weeks, of each month for a year,
 * then of each year (owner H2). Input in any order; the newest overall is always kept.
 */
export function thinRestorePoints(points: readonly { name: string; at: number }[], now: number): string[] {
  const keep = new Map<string, { name: string; at: number }>();
  for (const p of points) {
    const age = now - p.at;
    const d = new Date(p.at);
    const key = age < 4 * WEEK ? `w${Math.max(0, Math.floor(age / WEEK))}` : age < 365 * 86_400_000 ? `m${d.toISOString().slice(0, 7)}` : `y${d.getUTCFullYear()}`;
    const best = keep.get(key);
    if (!best || p.at > best.at) keep.set(key, p);
  }
  const kept = new Set([...keep.values()].map((p) => p.name));
  return points.filter((p) => !kept.has(p.name)).map((p) => p.name);
}

export async function listRestorePoints(acct: BackupDir): Promise<{ name: string; at: number; manifest: Manifest }[]> {
  const { items } = await listBackups(new SubDir(acct, RESTORE_POINTS), 10_000);
  return items.flatMap((i) => (i.manifest ? [{ name: i.name, at: Date.parse(i.manifest.created_at), manifest: i.manifest }] : []));
}

/** Write a restore point and thin the older ones (not when `thin` is false: a backup about to be restored from must stay). Returns the new point's manifest and how many were removed. */
export async function addRestorePoint(acct: BackupDir, snap: Snapshot, now: number, thin = true): Promise<{ manifest: Manifest; removed: string[] }> {
  const rp = new SubDir(acct, RESTORE_POINTS) as SubDir & { removeDir(path: string): Promise<void> };
  const manifest = await writeBackup(rp, snap);
  const all = await listRestorePoints(acct);
  const removed = thin ? thinRestorePoints(all, now) : [];
  for (const name of removed) await rp.removeDir(name);
  return { manifest, removed };
}

// ---- Index

export async function readIndex(acct: BackupDir): Promise<BackupIndex | undefined> {
  try {
    const raw = JSON.parse(decodeText(await acct.readFile(MANIFEST))) as Partial<BackupIndex>;
    return raw.format === INDEX_FORMAT ? (raw as BackupIndex) : undefined;
  } catch (e) {
    if (e instanceof EncryptedError) throw e;
    return undefined;
  }
}

export async function writeIndex(acct: BackupDir, index: Omit<BackupIndex, 'format' | 'format_version' | 'segments'>, newSegments: Record<string, FileInfo>): Promise<void> {
  const old = await readIndex(acct);
  const full: BackupIndex = { format: INDEX_FORMAT, format_version: 1, ...index, segments: { ...(old?.segments ?? {}), ...newSegments } };
  await acct.writeFile(MANIFEST, encodeText(`${JSON.stringify(full, null, 2)}\n`));
}

/** Accounts in a folder: sub-folders whose `manifest.json` is a backup index. */
export async function findAccounts(root: BackupDir): Promise<string[]> {
  const out: string[] = [];
  for (const name of await root.listDirs('')) {
    const index = await readIndex(new SubDir(root, name)).catch(() => undefined);
    if (index || (await root.exists(`${name}/${ENCRYPTION_FILE}`))) out.push(name);
  }
  return out;
}

// ---- Restore to a time

export interface TimeState {
  docs: Map<string, Y.Doc>;
  /** The restore point the state was built on; undefined when it was built from the segments alone. */
  base?: string;
  segments: number;
}

/**
 * The documents as they were at `at`: the newest restore point made by then (this account's, or
 * an older full backup in the folder root), then every segment that began by `at`. Yjs ignores
 * updates it already has, so overlapping segments (thinned copies) are harmless. Every file is
 * checked against the hash in its name or its manifest.
 */
export async function stateAtTime(root: BackupDir, accountId: string, at: number): Promise<TimeState> {
  const acct = new SubDir(root, accountId);
  await readIndex(acct); // fails with EncryptedError when the backups are encrypted and no key was given
  const candidates = [...(await listRestorePoints(acct)).map((p) => ({ ...p, dir: new SubDir(acct, `${RESTORE_POINTS}/${p.name}`) })), ...(await legacyBackups(root))]
    .filter((p) => p.at <= at)
    .sort((a, b) => b.at - a.at);
  const docs = new Map<string, Y.Doc>();
  const doc = (id: string): Y.Doc => {
    let d = docs.get(id);
    if (!d) docs.set(id, (d = new Y.Doc()));
    return d;
  };
  let base: string | undefined;
  const best = candidates[0];
  if (best) {
    const opened = await openBackup(best.dir);
    if (!opened.verification.ok) throw new Error(`The restore point ${best.name} is damaged: ${opened.verification.problems[0]}`);
    for (const d of opened.manifest.documents) Y.applyUpdate(doc(d.id), await best.dir.readFile(d.update));
    base = best.name;
  }
  let segments = 0;
  for (const folder of await acct.listDirs(HISTORY)) {
    const id = folder.replaceAll('~', '/');
    if (!isValidDocId(id) || isLogDoc(id)) continue;
    const files = (await acct.listFiles(`${HISTORY}/${folder}`)).filter((f) => f.endsWith('.seg')).sort();
    for (const file of files) {
      const start = Number(file.slice(0, 13));
      if (!(start <= at)) continue;
      const data = await acct.readFile(`${HISTORY}/${folder}/${file}`);
      if ((await sha256Hex(data)).slice(0, 16) !== file.slice(28, 44)) throw new Error(`${HISTORY}/${folder}/${file} does not match its checksum`);
      const { header, update } = decodeSegment(data);
      if (header.doc !== id) throw new Error(`${file} belongs to ${header.doc}, not ${id}`);
      Y.applyUpdate(doc(id), update);
      segments++;
    }
  }
  if (docs.size === 0) throw new Error('The folder holds nothing from before that time.');
  return { docs, base, segments };
}

/** Full backups made before restore points existed sit directly in the folder; they count as the oldest restore points. */
async function legacyBackups(root: BackupDir): Promise<{ name: string; at: number; dir: BackupDir }[]> {
  const { items } = await listBackups(root, 10_000);
  return items.flatMap((i) => (i.manifest ? [{ name: i.name, at: Date.parse(i.manifest.created_at), dir: new SubDir(root, i.name) as BackupDir }] : []));
}

/** A snapshot as an in-memory backup folder, ready for `openBackup` (the restore panel's input). */
export function snapshotDir(snap: Snapshot): MemoryDir {
  const dir = new MemoryDir();
  for (const [path, data] of snap.files) dir.files.set(path, data);
  dir.files.set(MANIFEST, encodeText(JSON.stringify(snap.manifest)));
  return dir;
}
