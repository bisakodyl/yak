import * as Y from 'yjs';
import { listAttachments } from '../core/blobs/attachments';
import { collection, createRecord, nowIso } from '../core/schema';
import type { MirrorRuntime } from './runtime';
import { watchFolder } from './runtime';

/**
 * Only with `?test` in the URL: lets the browser e2e mirror into the Origin Private File System and
 * play the part of an outside editor by writing files in that folder.
 */
export function installTestHook(rt: MirrorRuntime): void {
  const root = async (): Promise<FileSystemDirectoryHandle> => {
    const h = await rt.folder.handle();
    if (!h) throw new Error('no folder');
    return h;
  };
  const parent = async (path: string, create: boolean): Promise<{ dir: FileSystemDirectoryHandle; name: string }> => {
    const segs = path.split('/');
    const name = segs.pop() as string;
    let dir = await root();
    for (const s of segs) dir = await dir.getDirectoryHandle(s, { create });
    return { dir, name };
  };
  const doc = (space: string): Y.Doc => {
    const found = rt.spaces.find((s) => s.name.toLowerCase() === space.toLowerCase());
    if (!found) throw new Error(`no space ${space}`);
    return found.doc;
  };
  (window as unknown as { __mirror: unknown }).__mirror = {
    /** Live notes of a space by name: path to text. */
    notes: (space: string): Record<string, string> => {
      const out: Record<string, string> = {};
      collection(doc(space), 'notes').forEach((rec) => {
        if (rec.get('deleted') !== true) out[String(rec.get('path'))] = (rec.get('text') as Y.Text).toString();
      });
      return out;
    },
    addNote: (space: string, path: string, text: string): void => {
      const now = nowIso();
      createRecord(doc(space), 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
    },
    /** Append to the note at `path`, as typing at the end would. */
    appendToNote: (space: string, path: string, text: string): void => {
      collection(doc(space), 'notes').forEach((rec) => {
        if (rec.get('path') === path && rec.get('deleted') !== true) {
          const t = rec.get('text') as Y.Text;
          t.insert(t.length, text);
        }
      });
    },
    useOpfs: async (name: string) => {
      await rt.folder.useOriginPrivate(name);
      await rt.service.reset();
      await watchFolder(rt);
      await rt.service.refresh();
    },
    run: () => rt.service.run(),
    idle: () => rt.service.whenIdle(),
    state: () => rt.service.state,
    /** An outside editor writes a file. */
    writeFile: async (path: string, text: string) => {
      const { dir, name } = await parent(path, true);
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(text);
      await w.close();
    },
    readFile: async (path: string): Promise<string | undefined> => {
      try {
        const { dir, name } = await parent(path, false);
        return await (await (await dir.getFileHandle(name)).getFile()).text();
      } catch {
        return undefined;
      }
    },
    /** An outside program writes a binary file. */
    writeBytes: async (path: string, bytes: number[]) => {
      const { dir, name } = await parent(path, true);
      const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
      await w.write(new Uint8Array(bytes));
      await w.close();
    },
    readBytes: async (path: string): Promise<number[] | undefined> => {
      try {
        const { dir, name } = await parent(path, false);
        return [...new Uint8Array(await (await (await dir.getFileHandle(name)).getFile()).arrayBuffer())];
      } catch {
        return undefined;
      }
    },
    /** Live files of a space's index, by name. */
    attachments: (space: string): string[] => listAttachments(doc(space)).map((a) => a.name).sort(),
    removeFile: async (path: string) => {
      const { dir, name } = await parent(path, false);
      await dir.removeEntry(name);
    },
    files: async (): Promise<string[]> => {
      const out: string[] = [];
      const walk = async (d: FileSystemDirectoryHandle, prefix: string): Promise<void> => {
        for await (const [name, child] of (d as unknown as { entries(): AsyncIterable<[string, FileSystemHandle]> }).entries()) {
          if (child.kind === 'directory') await walk(child as FileSystemDirectoryHandle, `${prefix}${name}/`);
          else out.push(`${prefix}${name}`);
        }
      };
      await walk(await root(), '');
      return out.sort();
    },
  };
}
