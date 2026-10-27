/**
 * The small directory interface the backup logic writes to and reads from. Paths are relative,
 * `/`-separated, and checked by `isSafePath`. Two implementations: an in-memory one for tests and
 * single-file bundles, and one over a File System Access directory handle (a picked folder or the
 * Origin Private File System).
 */
export interface BackupDir {
  /** Write a file, creating parent folders. Replaces an existing file. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Read a file; rejects with `NotFoundError` when missing. */
  readFile(path: string): Promise<Uint8Array>;
  /** Names of the sub-folders of a folder (`''` for the root); empty when the folder is missing. */
  listDirs(path: string): Promise<string[]>;
  /** Names of the files directly in a folder; empty when the folder is missing. */
  listFiles(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  /** Delete a folder and everything in it (thinning restore points only). */
  removeDir?(path: string): Promise<void>;
  /** Delete a file. Only used by tests and the corrupt-file e2e step; backups never delete. */
  removeFile?(path: string): Promise<void>;
}

export class NotFoundError extends Error {
  constructor(path: string) {
    super(`Not found: ${path}`);
    this.name = 'NotFoundError';
  }
}

/** A relative path without empty, `.` or `..` segments or backslashes. */
export function isSafePath(path: string): boolean {
  if (!path || path.startsWith('/') || path.includes('\\') || path.includes('\0')) return false;
  return path.split('/').every((s) => s.length > 0 && s !== '.' && s !== '..');
}

function segments(path: string): string[] {
  if (path === '') return [];
  if (!isSafePath(path)) throw new Error(`Unsafe path: ${path}`);
  return path.split('/');
}

/** An in-memory directory: a map of file paths to bytes. */
export class MemoryDir implements BackupDir {
  readonly files = new Map<string, Uint8Array>();

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    segments(path);
    this.files.set(path, data.slice());
  }

  async readFile(path: string): Promise<Uint8Array> {
    const data = this.files.get(path);
    if (!data) throw new NotFoundError(path);
    return data.slice();
  }

  async listDirs(path: string): Promise<string[]> {
    const prefix = path === '' ? '' : `${path}/`;
    const out = new Set<string>();
    for (const file of this.files.keys()) {
      if (!file.startsWith(prefix)) continue;
      const rest = file.slice(prefix.length).split('/');
      if (rest.length > 1 && rest[0]) out.add(rest[0]);
    }
    return [...out].sort();
  }

  async listFiles(path: string): Promise<string[]> {
    const prefix = path === '' ? '' : `${path}/`;
    const out: string[] = [];
    for (const file of this.files.keys()) if (file.startsWith(prefix) && !file.slice(prefix.length).includes('/')) out.push(file.slice(prefix.length));
    return out.sort();
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }

  async removeDir(path: string): Promise<void> {
    segments(path);
    for (const file of [...this.files.keys()]) if (file.startsWith(`${path}/`)) this.files.delete(file);
  }

  /** A view of one sub-folder. */
  sub(path: string): MemoryDir {
    const out = new MemoryDir();
    const prefix = `${path}/`;
    for (const [k, v] of this.files) if (k.startsWith(prefix)) out.files.set(k.slice(prefix.length), v);
    return out;
  }
}

/** A directory over a File System Access handle (picked folder or OPFS). */
export class HandleDir implements BackupDir {
  constructor(readonly handle: FileSystemDirectoryHandle) {}

  private async dir(segs: string[], create: boolean): Promise<FileSystemDirectoryHandle> {
    let h = this.handle;
    for (const s of segs) h = await h.getDirectoryHandle(s, { create });
    return h;
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const segs = segments(path);
    const name = segs.pop() as string;
    const parent = await this.dir(segs, true);
    const fh = await parent.getFileHandle(name, { create: true });
    // createWritable writes to a temporary file and swaps it in on close, so a file is never half written.
    const w = await fh.createWritable();
    try {
      await w.write(data as Uint8Array<ArrayBuffer>);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const segs = segments(path);
    const name = segs.pop() as string;
    try {
      const parent = await this.dir(segs, false);
      const file = await (await parent.getFileHandle(name)).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (e) {
      if (e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError')) throw new NotFoundError(path);
      throw e;
    }
  }

  async listDirs(path: string): Promise<string[]> {
    let h: FileSystemDirectoryHandle;
    try {
      h = await this.dir(segments(path), false);
    } catch {
      return [];
    }
    const out: string[] = [];
    const entries = (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const [name, child] of entries) if (child.kind === 'directory') out.push(name);
    return out.sort();
  }

  async listFiles(path: string): Promise<string[]> {
    let h: FileSystemDirectoryHandle;
    try {
      h = await this.dir(segments(path), false);
    } catch {
      return [];
    }
    const out: string[] = [];
    const entries = (h as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries();
    for await (const [name, child] of entries) if (child.kind === 'file') out.push(name);
    return out.sort();
  }

  async removeDir(path: string): Promise<void> {
    const segs = segments(path);
    const name = segs.pop() as string;
    try {
      await (await this.dir(segs, false)).removeEntry(name, { recursive: true });
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'NotFoundError')) throw e;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.readFile(path);
      return true;
    } catch (e) {
      if (e instanceof NotFoundError) return false;
      throw e;
    }
  }

  async removeFile(path: string): Promise<void> {
    const segs = segments(path);
    const name = segs.pop() as string;
    await (await this.dir(segs, false)).removeEntry(name);
  }
}

/** A view of a sub-folder of another directory. */
export class SubDir implements BackupDir {
  constructor(
    private readonly parent: BackupDir,
    private readonly prefix: string,
  ) {
    segments(prefix);
  }
  private p(path: string): string {
    return path === '' ? this.prefix : `${this.prefix}/${path}`;
  }
  writeFile(path: string, data: Uint8Array): Promise<void> {
    return this.parent.writeFile(this.p(path), data);
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.parent.readFile(this.p(path));
  }
  listDirs(path: string): Promise<string[]> {
    return this.parent.listDirs(this.p(path));
  }
  listFiles(path: string): Promise<string[]> {
    return this.parent.listFiles(this.p(path));
  }
  exists(path: string): Promise<boolean> {
    return this.parent.exists(this.p(path));
  }
  async removeDir(path: string): Promise<void> {
    await this.parent.removeDir?.(this.p(path));
  }
  async removeFile(path: string): Promise<void> {
    await this.parent.removeFile?.(this.p(path));
  }
}
