// Kill switch: built to dist/sw.js instead of sw.ts when offline support is switched off
// (see docs/offline.md). It takes over from any installed version at once, deletes this app's
// caches, unregisters itself and reloads the open pages, which then load from the network.
// It has no fetch handler, so it never answers a request.
import { CACHE_PREFIX } from './sw-logic';
import type { SwExtendableEvent, SwGlobal } from './sw-types';

declare const self: SwGlobal;

self.addEventListener('install', () => void self.skipWaiting());
self.addEventListener('activate', (e: SwExtendableEvent) =>
  e.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (name.startsWith(CACHE_PREFIX)) await caches.delete(name);
      await self.registration.unregister();
      for (const client of await self.clients.matchAll({ type: 'window' })) {
        await client.navigate(client.url).catch(() => undefined);
      }
    })(),
  ),
);
