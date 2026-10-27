import { NotFoundError, SubDir, type BackupDir } from './dir';
import { BACKUP_NAME, MANIFEST, decodeText, encodeText, sha256Hex, upgradeManifest, type Manifest } from './format';
import type { Snapshot } from './snapshot';

class BackupWriteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupWriteError';
  }
}

/**
 * Write a snapshot as a new timestamped folder inside `root`, read every file back to check it,
 * and write `manifest.json` last. A folder without a manifest is an interrupted backup and is
 * never offered for restore. Existing backups are never changed or deleted.
 */
export async function writeBackup(root: BackupDir, snap: Snapshot): Promise<Manifest> {
  let name = snap.manifest.name;
  for (let n = 2; await root.exists(`${name}/${MANIFEST}`); n++) name = `${snap.manifest.name}-${n}`;
  const manifest: Manifest = { ...snap.manifest, name };
  const dir = new SubDir(root, name);
  for (const [path, data] of snap.files) await dir.writeFile(path, data);
  for (const [path, info] of Object.entries(manifest.files)) {
    const back = await dir.readFile(path);
    if (back.byteLength !== info.bytes || (await sha256Hex(back)) !== info.sha256) {
      throw new BackupWriteError(`${path} did not read back as written`);
    }
  }
  const manifestBytes = encodeText(`${JSON.stringify(manifest, null, 2)}\n`);
  await dir.writeFile(MANIFEST, manifestBytes);
  const back = await dir.readFile(MANIFEST);
  if ((await sha256Hex(back)) !== (await sha256Hex(manifestBytes))) throw new BackupWriteError('manifest.json did not read back as written');
  return manifest;
}

export interface BackupListing {
  name: string;
  /** Folder of the backup relative to the chosen folder, when it is not directly in it (a restore point). */
  path?: string;
  manifest?: Manifest;
  /** Why the manifest could not be read: an interrupted backup, or a damaged or newer one. */
  error?: string;
}

/** Read a backup's manifest. */
export async function readManifest(dir: BackupDir): Promise<Manifest> {
  const bytes = await dir.readFile(MANIFEST);
  let raw: unknown;
  try {
    raw = JSON.parse(decodeText(bytes));
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  return upgradeManifest(raw);
}

/** The backups in `root`, newest first (folder names sort by time), at most `limit`. */
export async function listBackups(root: BackupDir, limit = 50): Promise<{ items: BackupListing[]; total: number }> {
  const names = (await root.listDirs('')).filter((n) => BACKUP_NAME.test(n)).sort().reverse();
  const items: BackupListing[] = [];
  for (const name of names.slice(0, limit)) {
    try {
      items.push({ name, manifest: await readManifest(new SubDir(root, name)) });
    } catch (e) {
      items.push({ name, error: e instanceof NotFoundError ? 'Incomplete: no manifest (interrupted backup)' : errText(e) });
    }
  }
  return { items, total: names.length };
}

export function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
