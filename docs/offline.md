# Offline: reference

The user guide is `user/offline.md` (shown in the app under Help).
This file keeps the design and the kill switch.
The design choices are in `decisions/offline.md`.

## How updates appear

1. A new version is deployed.
2. The next time the app is opened or comes back into view (and at least every hour while open), the browser downloads the new version in the background.
   The version you are using keeps working meanwhile.
3. A banner says **A new version is available.** with a **Reload** button.
4. **Reload** switches to the new version and reloads the page once.
   Other open tabs of the app reload too, so no tab keeps running old code against new files.
   Your data is not touched; a running timer keeps running.

If you ignore the banner, the new version starts the next time every tab of the app has been closed.
The old saved copy is deleted as soon as the new version takes over.

Online, opening the app always asks the server first, so a fresh page load may already show the new version before the banner appears.
Pressing **Reload** then changes nothing visible and is harmless.

## If an update goes wrong: the kill switch

If a deployed version of the worker misbehaves (for example, the app keeps showing an old or broken copy), switch offline support off.
Your data is not affected; only the saved copy of the app's files is removed.

1. Build with offline support off and deploy as usual:
   - set the build variable `APP_OFFLINE=off` in the Cloudflare build settings, or
   - change the `OFFLINE` line in `vite.config.ts` to `'off'` and merge that change.
2. The deploy then contains a `sw.js` that does nothing except remove itself: it takes over at once, deletes the app's saved files, unregisters and reloads open pages.
   The app built this way also stops registering a worker and removes its own registration on load.
3. Every device recovers the next time it opens the app (or within the hour if a tab is left open), because the browser always checks `sw.js` with the server (`Cache-Control: no-cache` in `public/_headers`).
4. To turn offline support back on, remove the variable (or set the line back to `'on'`) and deploy again.

The probe page's own test worker (scope `/probe/`) is never touched by the app's worker or by the kill switch.

### By hand, on one device

In Chrome or Edge: open the app, then DevTools › Application › Service workers › **Unregister**, and Application › Storage › Cache storage › delete the `app-precache-…` entries.
Do **not** use "Clear site data": it also deletes IndexedDB, which holds your data.

## For developers

- `npm run dev` never registers the worker; only production builds do.
- The worker source is `src/offline/sw.ts` (rules in `sw-logic.ts`); `src/offline/build-plugin.ts` builds it into `dist/sw.js` after each `vite build`, with the list of files and a version derived from their contents.
- An identical rebuild gives an identical `sw.js`, so redeploying the same code shows no banner.
- To check what a device runs: DevTools › Application › Service workers shows the script; Cache storage shows `app-precache-<version>`.
- Browser test: `scripts/e2e/offline.mjs` (see `testing.md`).
