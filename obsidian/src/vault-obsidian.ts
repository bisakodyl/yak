import { TFile, TFolder, type App } from 'obsidian';
import type { VaultPort } from './vault-port';

/** The real vault behind `VaultPort`. */
export function obsidianPort(app: App): VaultPort {
  const vault = app.vault;
  const fileAt = (path: string): TFile => {
    const f = vault.getAbstractFileByPath(path);
    if (!(f instanceof TFile)) throw new Error(`No such file: ${path}`);
    return f;
  };
  const mkdirs = async (folder: string): Promise<void> => {
    let at = '';
    for (const part of folder.split('/').filter(Boolean)) {
      at = at ? `${at}/${part}` : part;
      if (!vault.getAbstractFileByPath(at)) await vault.createFolder(at);
    }
  };
  return {
    files: () => vault.getFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime, size: f.stat.size })),
    folders: () => vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder).map((f) => f.path),
    read: (path) => vault.read(fileAt(path)),
    readBinary: async (path) => new Uint8Array(await vault.readBinary(fileAt(path))),
    write: async (path, text) => {
      const existing = vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await vault.modify(existing, text);
      else {
        await mkdirs(path.slice(0, Math.max(path.lastIndexOf('/'), 0)));
        await vault.create(path, text);
      }
      const f = fileAt(path);
      return { path, mtime: f.stat.mtime, size: f.stat.size };
    },
    writeBinary: async (path, data) => {
      const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
      const existing = vault.getAbstractFileByPath(path);
      if (existing instanceof TFile) await vault.modifyBinary(existing, buffer);
      else {
        await mkdirs(path.slice(0, Math.max(path.lastIndexOf('/'), 0)));
        await vault.createBinary(path, buffer);
      }
      const f = fileAt(path);
      return { path, mtime: f.stat.mtime, size: f.stat.size };
    },
    remove: async (path) => {
      const f = vault.getAbstractFileByPath(path);
      if (f) await app.fileManager.trashFile(f);
    },
    // vault.rename moves without rewriting links: the mirror engine already rewrites them in the notes.
    rename: async (from, to) => {
      const f = vault.getAbstractFileByPath(from);
      if (!f) throw new Error(`No such file: ${from}`);
      await vault.rename(f, to);
    },
    createFolder: mkdirs,
  };
}
