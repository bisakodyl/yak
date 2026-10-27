import { uuid } from '../core/ids';
import { HandleDir, type BackupDir } from './dir';
import { kvGet, kvSet } from './device-db';
import type { FolderAccess, FolderInfo } from './service';

/** The chosen backup folder, as stored on this device. */
interface FolderRecord {
  handle: FileSystemDirectoryHandle;
  id: string;
  kind: 'picker' | 'opfs';
}

const KEY = 'folder';

type PermissionHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

type PickerWindow = {
  showDirectoryPicker?: (o?: { id?: string; mode?: 'read' | 'readwrite'; startIn?: string }) => Promise<FileSystemDirectoryHandle>;
};

/** Folder backups need `showDirectoryPicker` (Chrome, Edge); elsewhere only downloads work. */
export function folderPickerSupported(): boolean {
  return typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
}

async function permission(handle: FileSystemDirectoryHandle, mode: 'read' | 'readwrite', ask: boolean): Promise<PermissionState> {
  const h = handle as PermissionHandle;
  const fn = ask ? h.requestPermission : h.queryPermission;
  // Origin private folders have no permission methods in some browsers: they are always granted.
  if (typeof fn !== 'function') return 'granted';
  return fn.call(h, { mode });
}

/** Check the folder is still there (it may have been moved or deleted outside the browser). */
async function reachable(handle: FileSystemDirectoryHandle): Promise<string | undefined> {
  try {
    const it = (handle as unknown as { keys(): AsyncIterator<string> }).keys();
    await it.next();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The browser implementation of the service's folder access, plus the user-gesture actions. */
export class BrowserFolder implements FolderAccess {
  async current(): Promise<FolderInfo & { dir?: BackupDir }> {
    let rec: FolderRecord | undefined;
    try {
      rec = await kvGet<FolderRecord>(KEY);
    } catch (e) {
      return { state: 'error', error: `Could not read the saved folder: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!rec) return { state: folderPickerSupported() ? 'none' : 'unsupported' };
    const base = { name: rec.kind === 'opfs' ? `${rec.handle.name} (browser storage)` : rec.handle.name, id: rec.id };
    let state: PermissionState;
    try {
      state = await permission(rec.handle, 'readwrite', false);
    } catch (e) {
      return { ...base, state: 'error', error: e instanceof Error ? e.message : String(e) };
    }
    if (state !== 'granted') return { ...base, state };
    const problem = await reachable(rec.handle);
    if (problem) return { ...base, state: 'error', error: problem };
    return { ...base, state: 'granted', dir: new HandleDir(rec.handle) };
  }

  /** Ask for permission again (needs a click). Chrome may offer "Allow on every visit". */
  async requestAccess(): Promise<FolderInfo> {
    const rec = await kvGet<FolderRecord>(KEY);
    if (rec) await permission(rec.handle, 'readwrite', true);
    return this.current();
  }

  /** Let the user pick a folder (needs a click). Returns undefined when cancelled. */
  async choose(): Promise<FolderInfo | undefined> {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker;
    if (!picker) return undefined;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker({ id: 'backups', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return undefined;
      throw e;
    }
    await kvSet(KEY, { handle, id: uuid(), kind: 'picker' } satisfies FolderRecord);
    return this.current();
  }

  /** Back up into the Origin Private File System instead (tests; not visible to the user). */
  async useOriginPrivate(name: string): Promise<FolderInfo> {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle(name, { create: true });
    await kvSet(KEY, { handle, id: uuid(), kind: 'opfs' } satisfies FolderRecord);
    return this.current();
  }

  async forget(): Promise<void> {
    await kvSet(KEY, undefined);
  }
}

/** Pick any folder to restore from (read-only). Returns undefined when cancelled. */
export async function pickReadFolder(): Promise<BackupDir | undefined> {
  const picker = (window as unknown as PickerWindow).showDirectoryPicker;
  if (!picker) return undefined;
  try {
    return new HandleDir(await picker({ id: 'restore', mode: 'read' }));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') return undefined;
    throw e;
  }
}
