import type { FileInfo, MirrorFs } from '../../src/mirror/fs';
import { fromVaultLinks, toVaultLinks, type LinkSpace } from './links';
import type { VaultPort } from './vault-port';

/**
 * The mirror's file system over the vault's root folder (`Yak/` by default). Paths are
 * relative to the root, so a note is `<space folder>/<path>.md`. Nothing outside the root is read or
 * written. Links are translated between the note's form and the vault's form (`links.ts`).
 */
export class VaultFs implements MirrorFs {
  constructor(
    private readonly vault: VaultPort,
    readonly root: string,
    /** The kept spaces, for link translation; read at each call so renames and new notes count. */
    private readonly spaces: () => readonly LinkSpace[],
  ) {}

  private full(path: string): string {
    return `${this.root}/${path}`;
  }

  /** Pasted files may land anywhere in the space folder, so every file below it is listed. */
  readonly listsStrayFiles = true;

  async list(): Promise<FileInfo[]> {
    const prefix = `${this.root}/`;
    return this.vault
      .files()
      .filter((f) => f.path.startsWith(prefix) && f.path.indexOf('/', prefix.length) > 0)
      .map((f) => ({ path: f.path.slice(prefix.length), stamp: `${f.mtime}:${f.size}` }));
  }

  private space(path: string): LinkSpace | undefined {
    const folder = path.split('/')[0]!.toLowerCase();
    return this.spaces().find((s) => s.folder.toLowerCase() === folder);
  }

  async read(path: string): Promise<string> {
    const text = await this.vault.read(this.full(path));
    const space = this.space(path);
    return space ? fromVaultLinks(text, this.root, space, this.spaces()) : text;
  }

  async readBinary(path: string): Promise<Uint8Array> {
    return this.vault.readBinary(this.full(path));
  }

  async writeBinary(path: string, data: Uint8Array): Promise<string> {
    const f = await this.vault.writeBinary(this.full(path), data);
    return `${f.mtime}:${f.size}`;
  }

  async write(path: string, text: string): Promise<string> {
    const space = this.space(path);
    const out = space ? toVaultLinks(text, this.root, space, this.spaces()) : text;
    const f = await this.vault.write(this.full(path), out);
    return `${f.mtime}:${f.size}`;
  }

  async delete(path: string): Promise<void> {
    await this.vault.remove(this.full(path));
  }

  async rename(from: string, to: string): Promise<void> {
    const dir = to.includes('/') ? to.slice(0, to.lastIndexOf('/')) : '';
    if (dir) await this.vault.createFolder(this.full(dir));
    await this.vault.rename(this.full(from), this.full(to));
  }
}
