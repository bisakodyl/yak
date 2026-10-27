// Pure rules for the app's service worker (src/offline/sw.ts). No globals here, so every rule is
// unit-tested in sw-logic.test.ts. All paths are relative to the worker's scope (the site root in
// production), so the same build works under a sub-path.

/** What the build hands the worker: the page URLs and the hashed files to precache. */
export interface PrecacheManifest {
  /** Derived from the build output; changes whenever any precached file changes. */
  version: string;
  /** Canonical page paths relative to the scope: `''` for the app, `'probe'`. */
  pages: string[];
  /** Every other build file relative to the scope, such as `assets/main-abc123.js`. */
  assets: string[];
  /** This version asks people to make a backup before they reload into it (`src/offline/update-meta.json`). */
  backupFirst?: boolean;
}

/** Generic prefix (see STORAGE_PREFIX) so a rename does not orphan caches. */
export const CACHE_PREFIX = 'app-precache-';

/** How long a navigation waits for the network before the cached page is shown. */
export const NAV_TIMEOUT_MS = 3000;

/**
 * Paths the worker never answers, even when they are same-origin GETs:
 * the signaling relay, the probe's own test worker and its scope, and the worker scripts.
 */
const NEVER_PREFIXES = ['signal/', 'probe/'];
const NEVER_FILES = new Set(['sw.js', 'probe-sw.js']);

export function cacheName(version: string): string {
  return CACHE_PREFIX + version;
}

/** Caches this worker owns that belong to another version; deleted on activate. */
export function staleCaches(names: readonly string[], current: string): string[] {
  return names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current);
}

/** `index.html` → `''`, `probe.html` → `'probe'`, `docs/index.html` → `'docs/'`; anything else unchanged. */
export function pageKey(rel: string): string {
  if (rel === 'index.html' || rel.endsWith('/index.html')) return rel.slice(0, -'index.html'.length);
  if (rel.endsWith('.html')) return rel.slice(0, -'.html'.length);
  return rel;
}

export interface RequestLike {
  url: string;
  method: string;
  /** `Request.mode`: `navigate` for page loads. */
  mode: string;
  /** `Request.cache`. */
  cache?: string;
}

export type Route =
  /** Do not call respondWith: the browser fetches as if there were no worker. */
  | { kind: 'bypass' }
  /** Hashed build file: cache first, network if missing. */
  | { kind: 'asset'; key: string }
  /** Page load: network first with a short timeout, cached page as fallback. */
  | { kind: 'page'; key: string };

const BYPASS: Route = { kind: 'bypass' };

/** Decide how the worker treats one request. `scope` is the registration scope URL (ends in `/`). */
export function routeRequest(
  req: RequestLike,
  scope: string,
  pages: ReadonlySet<string>,
  assets: ReadonlySet<string>,
): Route {
  if (req.method !== 'GET') return BYPASS;
  // Chrome DevTools quirk: such requests fail when answered by a worker.
  if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return BYPASS;
  let url: URL;
  let base: URL;
  try {
    url = new URL(req.url);
    base = new URL(scope);
  } catch {
    return BYPASS;
  }
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return BYPASS;
  const rel = url.pathname.slice(base.pathname.length);
  if (NEVER_FILES.has(rel) || NEVER_PREFIXES.some((p) => rel.startsWith(p))) return BYPASS;

  if (req.mode === 'navigate') {
    const key = pageKey(rel);
    return pages.has(key) ? { kind: 'page', key: new URL(key, base).href } : BYPASS;
  }
  if (url.search === '' && assets.has(rel)) return { kind: 'asset', key: new URL(rel, base).href };
  return BYPASS;
}

/** Messages the page sends to a worker. */
export type ClientMessage = { type: 'SKIP_WAITING' } | { type: 'GET_VERSION' };

export function isClientMessage(data: unknown): data is ClientMessage {
  const t = (data as { type?: unknown } | null)?.type;
  return t === 'SKIP_WAITING' || t === 'GET_VERSION';
}
