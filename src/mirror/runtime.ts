import { useEffect, useState } from 'preact/hooks';
import { testMode } from '../core/test-build';
import { useApp } from '../app/context';
import { STORAGE_PREFIX } from '../constants';
import { emptyState } from './engine';
import { kvGet, kvSet } from './device-db';
import { BrowserFolder, folderMirrorSupported } from './folder';
import { MirrorService, type LockFn, type MirrorServiceState, type MirrorStore, type Persisted, type SpaceInput } from './service';

const KEY = 'persisted';

const deviceStore: MirrorStore = {
  async load(): Promise<Persisted> {
    const p = await kvGet<Persisted>(KEY);
    return { excluded: [], state: emptyState(), conflicts: [], ...p };
  },
  save: (p) => kvSet(KEY, p),
};

/** One mirror pass across all tabs of this app, with the Web Locks API where available. */
const webLock: LockFn = async (fn, wait) => {
  const locks = (navigator as Navigator & { locks?: LockManager }).locks;
  if (!locks?.request) return fn();
  return locks.request(`${STORAGE_PREFIX}-mirror`, { ifAvailable: !wait }, async (lock) => (lock ? fn() : 'busy'));
};

export interface MirrorRuntime {
  service: MirrorService;
  folder: BrowserFolder;
  /** The spaces this device keeps; replaced on every render of a component that uses the runtime. */
  spaces: SpaceInput[];
  stop(): void;
}

let runtime: MirrorRuntime | undefined;

/**
 * Created once, by the first mirror component that renders (the banner renders on every screen),
 * because modules get the documents only through the app context. Does nothing where the browser
 * cannot pick a folder.
 */
function mirrorRuntime(spaces: SpaceInput[]): MirrorRuntime {
  if (runtime) {
    runtime.spaces = spaces;
    return runtime;
  }
  const folder = new BrowserFolder();
  const rt: MirrorRuntime = { service: undefined as unknown as MirrorService, folder, spaces, stop: () => undefined };
  rt.service = new MirrorService({ spaces: () => rt.spaces, folder, store: deviceStore, lock: webLock });
  runtime = rt;
  if (folderMirrorSupported() || testMode()) {
    rt.stop = rt.service.start();
    void watchFolder(rt);
    if (testMode()) void import('./test-hook').then((m) => m.installTestHook(rt));
  }
  return rt;
}

/** Ask the browser to tell us about changes in the folder, where it can (File System Observer). */
export async function watchFolder(rt: MirrorRuntime): Promise<void> {
  await rt.folder.observe(() => rt.service.notifyFolderChanged());
}

export function useMirror(): MirrorRuntime & { state: MirrorServiceState } {
  const app = useApp();
  const rt = mirrorRuntime(app.spaces.map((s) => ({ id: s.id, name: s.name, doc: app.spaceDocs.get(s.id) as SpaceInput['doc'] })).filter((s) => s.doc));
  const [state, setState] = useState(rt.service.state);
  useEffect(() => {
    setState(rt.service.state);
    return rt.service.subscribe(setState);
  }, [rt]);
  return { ...rt, state };
}
