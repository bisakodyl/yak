// The app's service worker, built to dist/sw.js by build-plugin.ts with the precache manifest
// inlined. Rules live in sw-logic.ts; this file only wires them to the worker events.
//
// - install: fetch every page and hashed file of this build into one cache named after the version.
//   Any failure aborts the install, so the previous version stays in charge.
// - activate: delete the caches of other versions, take control of open pages.
// - fetch: hashed files cache first, page loads network first (3 s) with the cached page as
//   fallback; everything else (cross-origin, non-GET, /signal/*, /probe/*) is not touched.
// - A new version waits until the page sends SKIP_WAITING (the user pressed Reload).
import {
  NAV_TIMEOUT_MS,
  cacheName,
  isClientMessage,
  routeRequest,
  staleCaches,
  type PrecacheManifest,
} from './sw-logic';
import type { SwGlobal, SwExtendableEvent, SwFetchEvent, SwMessageEvent } from './sw-types';

declare const __PRECACHE_MANIFEST__: PrecacheManifest;
declare const self: SwGlobal;

const manifest = __PRECACHE_MANIFEST__;
const CACHE = cacheName(manifest.version);
const scope = self.registration.scope;
const pages = new Set(manifest.pages);
const assets = new Set(manifest.assets);

/** A cached response must not be marked as redirected, or the browser refuses it for a page load. */
async function storable(res: Response): Promise<Response> {
  if (!res.redirected) return res;
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

async function precache(): Promise<void> {
  const cache = await caches.open(CACHE);
  const urls = [...manifest.pages, ...manifest.assets].map((rel) => new URL(rel, scope).href);
  await Promise.all(
    urls.map(async (url) => {
      // no-cache: revalidate with the server so a stale HTTP cache never mixes versions.
      const res = await fetch(new Request(url, { cache: 'no-cache', credentials: 'same-origin' }));
      if (!res.ok) throw new Error(`precache ${url}: HTTP ${res.status}`);
      await cache.put(url, await storable(res));
    }),
  );
}

async function cleanup(): Promise<void> {
  for (const name of staleCaches(await caches.keys(), CACHE)) await caches.delete(name);
  await self.clients.claim();
}

async function cacheFirst(req: Request, key: string): Promise<Response> {
  const hit = await caches.match(key, { cacheName: CACHE });
  return hit ?? fetch(req);
}

async function networkFirst(req: Request, key: string): Promise<Response> {
  const cached = caches.match(key, { cacheName: CACHE });
  const network = fetch(req);
  // The cached page may be served instead; never leave the network promise unhandled.
  network.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((r) => {
    timer = setTimeout(() => r(undefined), NAV_TIMEOUT_MS);
  });
  try {
    const res = await Promise.race([network, timeout]);
    // A server error (5xx, 404 during a deploy) is worse than the last good page.
    if (res && (res.ok || res.type === 'opaqueredirect' || !(await cached))) return res;
  } catch {
    // offline or DNS failure: fall through to the cache
  } finally {
    clearTimeout(timer);
  }
  return (await cached) ?? network;
}

self.addEventListener('install', (e: SwExtendableEvent) => e.waitUntil(precache()));
self.addEventListener('activate', (e: SwExtendableEvent) => e.waitUntil(cleanup()));

self.addEventListener('message', (e: SwMessageEvent) => {
  if (!isClientMessage(e.data)) return;
  if (e.data.type === 'SKIP_WAITING') void self.skipWaiting();
  else e.ports[0]?.postMessage({ version: manifest.version, backupFirst: manifest.backupFirst === true });
});

self.addEventListener('fetch', (e: SwFetchEvent) => {
  const route = routeRequest(e.request, scope, pages, assets);
  if (route.kind === 'asset') e.respondWith(cacheFirst(e.request, route.key));
  else if (route.kind === 'page') e.respondWith(networkFirst(e.request, route.key));
});
