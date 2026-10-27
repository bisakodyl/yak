// Page side of offline support: register the worker, notice a waiting update, and switch to it
// when the user asks. Every browser API is feature-detected and every failure is swallowed:
// without a worker the app works exactly as before, only not offline.

declare const __OFFLINE_MODE__: 'on' | 'off';

/** How often an open tab asks the server for a new sw.js, besides on load, focus and reconnect. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;
/** Reload anyway if the new worker has not taken over this long after Reload was pressed. */
const RELOAD_FALLBACK_MS = 4000;

type Listener = (updateReady: boolean, backupFirst: boolean) => void;

let waiting: ServiceWorker | null = null;
let backupFirst = false;
let reloading = false;
const listeners = new Set<Listener>();

function notify(): void {
  for (const l of listeners) l(waiting !== null, backupFirst);
}

/** Ask a waiting version whether it wants a backup first (its answer comes from its own build). Never rejects; no answer means no. */
export function askBackupFirst(worker: Pick<ServiceWorker, 'postMessage'>, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const channel = new MessageChannel();
      const timer = setTimeout(() => resolve(false), timeoutMs);
      channel.port1.onmessage = (e: MessageEvent) => {
        clearTimeout(timer);
        resolve((e.data as { backupFirst?: unknown } | null)?.backupFirst === true);
      };
      worker.postMessage({ type: 'GET_VERSION' }, [channel.port2]);
    } catch {
      resolve(false);
    }
  });
}

function setWaiting(worker: ServiceWorker | null): void {
  if (worker === waiting) return;
  waiting = worker;
  backupFirst = false;
  notify();
  if (worker) {
    void askBackupFirst(worker).then((yes) => {
      if (waiting !== worker || yes === backupFirst) return;
      backupFirst = yes;
      notify();
    });
  }
}

/** Subscribe to "a new version is installed and waiting"; returns the unsubscribe function. */
export function onUpdateReady(listener: Listener): () => void {
  listeners.add(listener);
  listener(waiting !== null, backupFirst);
  return () => listeners.delete(listener);
}

function reloadOnce(): void {
  if (reloading) return;
  reloading = true;
  location.reload();
}

/** Activate the waiting version; the page reloads once it has taken over. */
export function applyUpdate(): void {
  if (!waiting) {
    reloadOnce();
    return;
  }
  waiting.postMessage({ type: 'SKIP_WAITING' });
  setTimeout(reloadOnce, RELOAD_FALLBACK_MS);
}

/** The scope the app registers: the directory of the app page, never the probe's `/probe/`. */
function appScope(): string {
  return new URL('./', document.baseURI).href;
}

function watch(reg: ServiceWorkerRegistration): void {
  const check = (): void => {
    // A waiting worker with no controller means this is the very first install: nothing to offer.
    if (reg.waiting && navigator.serviceWorker.controller) setWaiting(reg.waiting);
  };
  check();
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    worker?.addEventListener('statechange', () => {
      if (worker.state === 'installed') check();
    });
  });
  const update = (): void => {
    reg.update().catch(() => undefined);
  };
  setInterval(update, UPDATE_CHECK_MS);
  window.addEventListener('online', update);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') update();
  });
}

/** Remove this app's own registration (kill switch); the probe's test worker is left alone. */
async function unregisterApp(container: ServiceWorkerContainer): Promise<void> {
  for (const reg of await container.getRegistrations()) {
    if (reg.scope === appScope()) await reg.unregister();
  }
}

/** Called once from main.tsx in production builds. Never throws. */
export async function startOffline(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return;
    const container = navigator.serviceWorker;
    if (__OFFLINE_MODE__ === 'off') {
      await unregisterApp(container);
      return;
    }
    // Reload when a new version takes over this page, so code and cache always match.
    // The first install (no controller yet) takes over silently.
    let hadController = container.controller !== null;
    container.addEventListener('controllerchange', () => {
      if (hadController) reloadOnce();
      hadController = true;
    });
    const reg = await container.register(new URL('sw.js', document.baseURI).href, { scope: appScope() });
    watch(reg);
  } catch {
    // Blocked by policy, private mode, or an insecure origin: the app still works online.
  }
}
