import * as Y from 'yjs';
import { APP_NAME } from '../constants';
import {
  FORMAT_VERSION,
  PARTITION,
  addCounts,
  backupName,
  base64,
  docFolder,
  emptyCounts,
  encodeText,
  notePath,
  partitionKey,
  sha256Hex,
  type DocCounts,
  type BackupBlob,
  type BlobStorage,
  type FileInfo,
  type Manifest,
  type ManifestDoc,
} from './format';

/** A backup in memory: every file by path, and the manifest describing them. */
export interface Snapshot {
  manifest: Manifest;
  files: Map<string, Uint8Array>;
  /** SHA-256 over every document's full update: equal keys mean nothing changed. */
  contentKey: string;
}

export interface SnapshotOptions {
  deviceId: string;
  reason: string;
  now?: Date;
  /** Write the human-readable exports (default). Off for encrypted backups, which hold only the Yjs data. */
  readable?: boolean;
  /** The files of the notes this backup carries (their bytes are written beside the snapshot, never held in it), and where those bytes go. */
  files?: { blobs: BackupBlob[]; missing: number; storage: BlobStorage };
}

const RECORD_MAPS = ['time_entries', 'projects', 'clients', 'tags', 'notes'] as const;

/** Plain value of a field; Yjs types become their JSON form. */
function plain(v: unknown): unknown {
  return v instanceof Y.AbstractType ? v.toJSON() : v;
}

/** A record as a plain object with its id first. Every field is kept, `deleted` included. */
function recordObject(id: string, record: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = { id };
  if (record instanceof Y.Map) record.forEach((v, k) => (out[k] = plain(v)));
  else out.value = plain(record);
  return out;
}

function sortKey(r: Record<string, unknown>, field: string): string {
  return `${typeof r[field] === 'string' ? r[field] : ''}\u0000${String(r.id)}`;
}

/** Locale-independent order (UTF-16 code units), so the same data always gives the same files. */
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

const json = (v: unknown): Uint8Array => encodeText(`${JSON.stringify(v, null, 2)}\n`);

/**
 * Root types the backup reads by name. Reading a root with the wrong Yjs type would redefine
 * it, so only these known maps are read with `getMap`; other roots are read only when they
 * already have a concrete type.
 */
function knownMap(doc: Y.Doc, name: string): Y.Map<unknown> | undefined {
  const existing = doc.share.get(name);
  if (existing instanceof Y.Map) return existing;
  if (existing?.constructor === Y.AbstractType) return doc.getMap(name);
  return undefined;
}

/** Human-readable files of one document, relative to its folder. */
function exportDoc(doc: Y.Doc): { files: Map<string, Uint8Array>; counts: DocCounts } {
  const files = new Map<string, Uint8Array>();
  const counts = emptyCounts();

  const records = (name: string): Record<string, unknown>[] => {
    const map = knownMap(doc, name);
    const out: Record<string, unknown>[] = [];
    map?.forEach((record, id) => out.push(recordObject(id, record)));
    return out;
  };

  for (const name of RECORD_MAPS) {
    const list = records(name);
    counts[name] = { total: list.length, deleted: list.filter((r) => r.deleted === true).length };
  }

  // Time entries: JSON Lines, one file per partition, every field including soft deletes.
  const byPeriod = new Map<string, Record<string, unknown>[]>();
  for (const entry of records('time_entries')) {
    const key = partitionKey(entry);
    let list = byPeriod.get(key);
    if (!list) byPeriod.set(key, (list = []));
    list.push(entry);
  }
  for (const [key, list] of [...byPeriod].sort(([a], [b]) => cmp(a, b))) {
    list.sort((a, b) => cmp(sortKey(a, 'start'), sortKey(b, 'start')));
    files.set(`time_entries/${key}.jsonl`, encodeText(list.map((e) => `${JSON.stringify(e)}\n`).join('')));
  }

  for (const name of ['projects', 'clients', 'tags'] as const) {
    const list = records(name).sort((a, b) => cmp(sortKey(a, 'created_at'), sortKey(b, 'created_at')));
    if (list.length > 0) files.set(`${name}.json`, json(list));
  }

  // Notes: live notes as Markdown files at their path; an index with every note's metadata.
  const notes = records('notes').sort((a, b) => cmp(sortKey(a, 'path'), sortKey(b, 'path')));
  if (notes.length > 0) {
    const taken = new Set<string>();
    const index = notes.map((n) => {
      const { text, ...meta } = n;
      if (n.deleted === true) return { ...meta, file: null };
      const file = `notes/${notePath(String(n.path ?? ''), String(n.id), taken)}`;
      files.set(file, encodeText(typeof text === 'string' ? text : ''));
      return { ...meta, file };
    });
    files.set('notes.json', json(index));
  }

  for (const name of ['settings', 'meta']) {
    const map = knownMap(doc, name);
    if (map && map.size > 0) files.set(`${name}.json`, json(map.toJSON()));
  }
  return { files, counts };
}

/**
 * Take a backup of the given documents. The Yjs state of every document is encoded first, in one
 * synchronous step, so the backup is one consistent moment across documents.
 */
export async function createSnapshot(docs: ReadonlyMap<string, Y.Doc>, opts: SnapshotOptions): Promise<Snapshot> {
  const now = opts.now ?? new Date();
  const ids = [...docs.keys()].sort();
  const encoded = ids.map((id) => {
    const doc = docs.get(id) as Y.Doc;
    return { id, doc, update: Y.encodeStateAsUpdate(doc), stateVector: Y.encodeStateVector(doc) };
  });

  const files = new Map<string, Uint8Array>();
  const documents: ManifestDoc[] = [];
  let totals = emptyCounts();
  for (const { id, doc, update, stateVector } of encoded) {
    const folder = docFolder(id);
    files.set(`${folder}/update.ybin`, update);
    files.set(`${folder}/state-vector.ybin`, stateVector);
    // Readable files come from a copy of the encoded state, so they match the update exactly
    // even if the live document changes while checksums are computed.
    const copy = new Y.Doc();
    Y.applyUpdate(copy, update);
    for (const name of doc.share.keys()) {
      const t = doc.share.get(name);
      if (t instanceof Y.Map) copy.getMap(name);
      else if (t instanceof Y.Text) copy.getText(name);
      else if (t instanceof Y.Array) copy.getArray(name);
    }
    const exported = exportDoc(copy);
    copy.destroy();
    const exports: string[] = [];
    for (const [rel, data] of opts.readable === false ? [] : exported.files) {
      files.set(`${folder}/${rel}`, data);
      exports.push(`${folder}/${rel}`);
    }
    totals = addCounts(totals, exported.counts);
    documents.push({
      id,
      folder,
      update: `${folder}/update.ybin`,
      state_vector: `${folder}/state-vector.ybin`,
      state_vector_base64: base64(stateVector),
      counts: exported.counts,
      exports,
    });
  }

  const info: Record<string, FileInfo> = {};
  for (const [path, data] of [...files].sort(([a], [b]) => cmp(a, b))) {
    info[path] = { sha256: await sha256Hex(data), bytes: data.byteLength };
  }

  // The files are part of the key: bytes that arrive later change what a backup holds although no document changed.
  const keyParts = [...encoded.map((e) => `${e.id}:${info[`${docFolder(e.id)}/update.ybin`]?.sha256}`), ...(opts.files?.blobs ?? []).map((b) => `file:${b.unit}/${b.hash}`)].join('\n');
  const contentKey = await sha256Hex(encodeText(keyParts));

  const manifest: Manifest = {
    format: 'backup',
    format_version: FORMAT_VERSION,
    app: APP_NAME,
    name: backupName(now, opts.deviceId),
    created_at: now.toISOString(),
    device_id: opts.deviceId,
    reason: opts.reason,
    partition: PARTITION,
    documents,
    files: info,
    counts: totals,
    blobs: opts.files?.blobs ?? [],
    blob_storage: opts.files?.storage ?? 'none',
    blobs_missing: opts.files?.missing ?? 0,
  };
  return { manifest, files, contentKey };
}
