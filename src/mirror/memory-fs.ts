import type { FileInfo, MirrorFs } from './fs';

/** An in-memory `MirrorFs` with helpers that play the part of an outside editor. */
export class MemoryFs implements MirrorFs {
  private files = new Map<string, { text: string; bytes?: Uint8Array; version: number }>();
  private counter = 0;

  async list(): Promise<FileInfo[]> {
    return [...this.files].map(([path, f]) => ({ path, stamp: String(f.version) }));
  }

  async read(path: string): Promise<string> {
    const f = this.files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f.bytes ? new TextDecoder().decode(f.bytes) : f.text;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const f = this.files.get(path);
    if (!f) throw new Error(`No such file: ${path}`);
    return f.bytes ?? new TextEncoder().encode(f.text);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<string> {
    const version = ++this.counter;
    this.files.set(path, { text: '', bytes: data.slice(), version });
    return String(version);
  }

  async write(path: string, text: string): Promise<string> {
    const version = ++this.counter;
    this.files.set(path, { text, version });
    return String(version);
  }

  async delete(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`No such file: ${path}`);
  }

  async rename(from: string, to: string): Promise<void> {
    const f = this.files.get(from);
    if (!f) throw new Error(`No such file: ${from}`);
    if (this.files.has(to)) throw new Error(`File exists: ${to}`);
    this.files.delete(from);
    this.files.set(to, f);
  }

  /** Test helper: the text of a file, or undefined. */
  text(path: string): string | undefined {
    const f = this.files.get(path);
    return f && !f.bytes ? f.text : undefined;
  }

  /** Test helper: the bytes of a file, or undefined. */
  bytes(path: string): Uint8Array | undefined {
    const f = this.files.get(path);
    return f ? (f.bytes ?? new TextEncoder().encode(f.text)) : undefined;
  }

  /** Test helper: an outside program adds or replaces a binary file. */
  putBytes(path: string, data: Uint8Array): void {
    this.files.set(path, { text: '', bytes: data.slice(), version: ++this.counter });
  }

  /** Test helper: sorted paths. */
  paths(): string[] {
    return [...this.files.keys()].sort();
  }
}
