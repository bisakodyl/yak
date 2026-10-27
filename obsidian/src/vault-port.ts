/**
 * The few things the plugin needs from a vault, so the adapter and the rules can be tested without
 * Obsidian. `obsidianPort` (main.ts) is the real one; `MemoryVault` the test double.
 * Paths are vault paths with `/` separators and no leading slash.
 */

export interface VaultFile {
  path: string;
  mtime: number;
  size: number;
}

export interface VaultPort {
  /** Every file in the vault. */
  files(): VaultFile[];
  /** Every folder in the vault. */
  folders(): string[];
  read(path: string): Promise<string>;
  readBinary(path: string): Promise<Uint8Array>;
  /** Create or replace a file, creating folders as needed. Returns its new mtime and size. */
  write(path: string, text: string): Promise<VaultFile>;
  writeBinary(path: string, data: Uint8Array): Promise<VaultFile>;
  /** Move to the vault's trash (the user's own setting decides where it goes). */
  remove(path: string): Promise<void>;
  /** Move a file or a folder; the target does not exist. */
  rename(from: string, to: string): Promise<void>;
  createFolder(path: string): Promise<void>;
}

export class MemoryVault implements VaultPort {
  private readonly data = new Map<string, { text: string; mtime: number; bytes?: Uint8Array }>();
  private readonly dirs = new Set<string>();
  private clock = 0;
  /** Paths moved to the trash, for tests. */
  readonly trashed: string[] = [];

  files(): VaultFile[] {
    return [...this.data].map(([path, f]) => ({ path, mtime: f.mtime, size: f.bytes?.length ?? f.text.length }));
  }

  folders(): string[] {
    return [...this.dirs];
  }

  async read(path: string): Promise<string> {
    const f = this.data.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f.bytes ? new TextDecoder().decode(f.bytes) : f.text;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const f = this.data.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f.bytes ?? new TextEncoder().encode(f.text);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<VaultFile> {
    this.mkdirs(path);
    const mtime = ++this.clock;
    this.data.set(path, { text: '', mtime, bytes: data.slice() });
    return { path, mtime, size: data.length };
  }

  /** Test helper: the user adds or replaces a binary file in Obsidian. */
  putBytes(path: string, data: Uint8Array): void {
    this.mkdirs(path);
    this.data.set(path, { text: '', mtime: ++this.clock, bytes: data.slice() });
  }

  /** Test helper: the bytes of a file, or undefined. */
  bytes(path: string): Uint8Array | undefined {
    const f = this.data.get(path);
    return f ? (f.bytes ?? new TextEncoder().encode(f.text)) : undefined;
  }

  private mkdirs(path: string): void {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) this.dirs.add(parts.slice(0, i).join('/'));
  }

  async write(path: string, text: string): Promise<VaultFile> {
    this.mkdirs(path);
    const mtime = ++this.clock;
    this.data.set(path, { text, mtime });
    return { path, mtime, size: text.length };
  }

  async remove(path: string): Promise<void> {
    if (this.data.delete(path)) {
      this.trashed.push(path);
      return;
    }
    if (!this.dirs.delete(path)) throw new Error(`No such file: ${path}`);
    for (const key of [...this.data.keys()]) if (key.startsWith(`${path}/`)) this.data.delete(key);
    for (const d of [...this.dirs]) if (d.startsWith(`${path}/`)) this.dirs.delete(d);
    this.trashed.push(path);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.data.has(to) || this.dirs.has(to)) throw new Error(`File exists: ${to}`);
    const f = this.data.get(from);
    if (f) {
      this.data.delete(from);
      this.mkdirs(to);
      this.data.set(to, { ...f, mtime: ++this.clock });
      return;
    }
    if (!this.dirs.has(from)) throw new Error(`No such file: ${from}`);
    this.mkdirs(`${to}/x`);
    for (const [key, val] of [...this.data]) {
      if (!key.startsWith(`${from}/`)) continue;
      this.data.delete(key);
      this.data.set(`${to}${key.slice(from.length)}`, val);
    }
    for (const d of [...this.dirs]) {
      if (d === from || d.startsWith(`${from}/`)) {
        this.dirs.delete(d);
        this.dirs.add(`${to}${d.slice(from.length)}`);
      }
    }
  }

  async createFolder(path: string): Promise<void> {
    this.mkdirs(`${path}/x`);
  }

  /** Test helper: the user edits or creates a file in Obsidian. */
  put(path: string, text: string): void {
    this.mkdirs(path);
    this.data.set(path, { text, mtime: ++this.clock });
  }

  /** Test helper: the text of a file, or undefined. */
  text(path: string): string | undefined {
    return this.data.get(path)?.text;
  }

  /** Test helper: the user deletes a whole folder in Obsidian. */
  dropFolder(path: string): void {
    for (const key of [...this.data.keys()]) if (key.startsWith(`${path}/`)) this.data.delete(key);
    for (const d of [...this.dirs]) if (d === path || d.startsWith(`${path}/`)) this.dirs.delete(d);
  }
}
