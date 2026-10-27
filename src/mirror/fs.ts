/**
 * The file system the mirror engine writes to. One adapter per route (browser folder, Obsidian
 * vault, desktop helper); `memory-fs.ts` is the one used by tests.
 * Paths are relative to the mirrored root, with `/` separators.
 */

export interface FileInfo {
  path: string;
  /** Opaque change token (for example mtime and size). A different stamp means "maybe changed". */
  stamp: string;
}

export interface MirrorFs {
  /**
   * Every note file under the root, folders included in the paths, and the files directly in a
   * space's `attachments/` folder (any type).
   */
  list(): Promise<FileInfo[]>;
  read(path: string): Promise<string>;
  /** Create or replace a file, creating folders as needed. Returns the new stamp. */
  write(path: string, text: string): Promise<string>;
  /** Bytes of any file (attachments, #166). */
  readBinary(path: string): Promise<Uint8Array>;
  /** Create or replace a file with bytes, creating folders as needed. Returns the new stamp. */
  writeBinary(path: string, data: Uint8Array): Promise<string>;
  delete(path: string): Promise<void>;
  /** Move a file; the target does not exist. */
  rename(from: string, to: string): Promise<void>;
  /**
   * `list` also returns other files below a space folder, outside `attachments/` (Obsidian puts
   * pasted files next to the note); the engine copies them into `attachments/`.
   */
  readonly listsStrayFiles?: boolean;
}
