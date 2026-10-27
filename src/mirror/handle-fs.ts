import type { FileInfo, MirrorFs } from './fs';

type Entries = { entries(): AsyncIterable<[string, FileSystemHandle]> };

function isNotFound(e: unknown): boolean {
  return e instanceof DOMException && (e.name === 'NotFoundError' || e.name === 'TypeMismatchError');
}

/**
 * A `MirrorFs` over a File System Access directory handle: a folder the user picked (Chrome, Edge)
 * or the Origin Private File System (browser tests). `list` walks Markdown files and the files
 * directly in a space's `attachments/` folder, and skips hidden folders such as `.obsidian` and `.git`.
 */
/** `Space/attachments/`: one level below the root, the folder the engine reads files from. */
function isAttachment(prefix: string): boolean {
  return /^[^/]+\/attachments\/$/i.test(prefix);
}

export class HandleFs implements MirrorFs {
  constructor(private readonly root: FileSystemDirectoryHandle) {}

  async list(): Promise<FileInfo[]> {
    const out: FileInfo[] = [];
    const walk = async (dir: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
      for await (const [name, child] of (dir as unknown as Entries).entries()) {
        if (name.startsWith('.')) continue;
        if (child.kind === 'directory') {
          await walk(child as FileSystemDirectoryHandle, `${prefix}${name}/`);
        } else if (/\.md$/i.test(name) || isAttachment(prefix)) {
          try {
            const file = await (child as FileSystemFileHandle).getFile();
            out.push({ path: `${prefix}${name}`, stamp: `${file.lastModified}:${file.size}` });
          } catch (e) {
            // Deleted between listing and reading: the next pass sees it gone.
            if (!isNotFound(e)) throw e;
          }
        }
      }
    };
    await walk(this.root, '');
    return out;
  }

  private async parent(path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
    const segs = path.split('/');
    const name = segs.pop() as string;
    let dir = this.root;
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
    return { dir, name };
  }

  async read(path: string): Promise<string> {
    const { dir, name } = await this.parent(path, false);
    return (await (await dir.getFileHandle(name)).getFile()).text();
  }

  async readBinary(path: string): Promise<Uint8Array> {
    const { dir, name } = await this.parent(path, false);
    return new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer());
  }

  async write(path: string, text: string): Promise<string> {
    return this.save(path, text);
  }

  async writeBinary(path: string, data: Uint8Array): Promise<string> {
    return this.save(path, data);
  }

  private async save(path: string, data: string | Uint8Array): Promise<string> {
    const { dir, name } = await this.parent(path, true);
    const handle = await dir.getFileHandle(name, { create: true });
    // createWritable writes a temporary file and swaps it in on close: a file is never half written.
    const w = await handle.createWritable();
    try {
      await w.write(data as FileSystemWriteChunkType);
      await w.close();
    } catch (e) {
      await w.abort().catch(() => undefined);
      throw e;
    }
    const file = await handle.getFile();
    return `${file.lastModified}:${file.size}`;
  }

  async delete(path: string): Promise<void> {
    const { dir, name } = await this.parent(path, false);
    await dir.removeEntry(name);
  }

  async rename(from: string, to: string): Promise<void> {
    // `FileSystemFileHandle.move` is not available everywhere, so copy then delete.
    const data = await this.readBinary(from);
    await this.writeBinary(to, data);
    await this.delete(from);
  }
}
