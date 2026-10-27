import { uuid } from '../core/ids';
import { kvGet, kvSet } from './device-db';
import { HandleFs } from './handle-fs';
import type { FolderAccess, FolderInfo } from './service';
import type { MirrorFs } from './fs';

/** The chosen folder, as stored on this device. */
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

/** The mirror needs `showDirectoryPicker` (Chrome, Edge on a computer); elsewhere it is hidden. */
export function folderMirrorSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as PickerWindow).showDirectoryPicker === 'function';
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
    await (handle as unknown as { keys(): AsyncIterator<string> }).keys().next();
    return undefined;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

interface ObserverApi {
  observe(handle: FileSystemHandle, options?: { recursive?: boolean }): Promise<void>;
  disconnect(): void;
}
type ObserverCtor = new (callback: () => void) => ObserverApi;

/** The browser implementation of the service's folder access, plus the user-gesture actions. */
export class BrowserFolder implements FolderAccess {
  private observer: ObserverApi | undefined;

  async current(): Promise<FolderInfo & { fs?: MirrorFs }> {
    let rec: FolderRecord | undefined;
    try {
      rec = await kvGet<FolderRecord>(KEY);
    } catch (e) {
      return { state: 'error', error: `Could not read the saved folder: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!rec) return { state: folderMirrorSupported() ? 'none' : 'unsupported' };
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
    return { ...base, state: 'granted', fs: new HandleFs(rec.handle) };
  }

  /** Ask for permission again (needs a click). */
  async requestAccess(): Promise<void> {
    const rec = await kvGet<FolderRecord>(KEY);
    if (rec) await permission(rec.handle, 'readwrite', true);
  }

  /** Let the user pick a folder (needs a click). Returns false when cancelled. */
  async choose(): Promise<boolean> {
    const picker = (window as unknown as PickerWindow).showDirectoryPicker;
    if (!picker) return false;
    let handle: FileSystemDirectoryHandle;
    try {
      handle = await picker({ id: 'mirror', mode: 'readwrite', startIn: 'documents' });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return false;
      throw e;
    }
    await kvSet(KEY, { handle, id: uuid(), kind: 'picker' } satisfies FolderRecord);
    return true;
  }

  /** Mirror into the Origin Private File System instead (tests; not visible to the user). */
  async useOriginPrivate(name: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const handle = await root.getDirectoryHandle(name, { create: true });
    await kvSet(KEY, { handle, id: uuid(), kind: 'opfs' } satisfies FolderRecord);
  }

  /** The OPFS folder handle, for tests that play the part of an outside editor. */
  async handle(): Promise<FileSystemDirectoryHandle | undefined> {
    return (await kvGet<FolderRecord>(KEY))?.handle;
  }

  async forget(): Promise<void> {
    this.unobserve();
    await kvSet(KEY, undefined);
  }

  /** Call `onChange` when the browser reports a change in the folder (File System Observer), if it can. */
  async observe(onChange: () => void): Promise<boolean> {
    const Ctor = (globalThis as unknown as { FileSystemObserver?: ObserverCtor }).FileSystemObserver;
    const rec = await kvGet<FolderRecord>(KEY);
    this.unobserve();
    if (!Ctor || !rec) return false;
    try {
      const observer = new Ctor(onChange);
      await observer.observe(rec.handle, { recursive: true });
      this.observer = observer;
      return true;
    } catch {
      return false;
    }
  }

  private unobserve(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }
}
