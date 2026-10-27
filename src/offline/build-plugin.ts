// Vite plugin (build only): after the site is written to dist/, list its files, derive the version
// and build src/offline/sw.ts (or the kill switch, sw-kill.ts) into dist/sw.js as one classic
// script with the manifest inlined. No hand-kept file lists and no extra dependencies: the worker
// is bundled by a second, minimal Vite library build.
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { build, type Logger, type Plugin } from 'vite';
import { APP_NAME } from '../constants';
import { buildWebManifest } from '../pwa/manifest';
import { buildManifest, type BuildFile } from './precache';

export type OfflineMode = 'on' | 'off';

/** Every file under dir, relative with forward slashes (the bundle misses files copied from public/). */
function walk(dir: string, prefix = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    const rel = prefix + name;
    return statSync(join(dir, name)).isDirectory() ? walk(join(dir, name), `${rel}/`) : [rel];
  });
}

const sha256 = (data: string | Uint8Array): string => createHash('sha256').update(data).digest('hex');

export function offlinePlugin(mode: OfflineMode): Plugin {
  let outDir = 'dist';
  let root = process.cwd();
  let files: BuildFile[] = [];
  let logger: Logger | undefined;
  const here = (name: string): string => resolve(root, 'src/offline', name);
  return {
    name: 'app-offline-sw',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      logger = config.logger;
      outDir = resolve(config.root, config.build.outDir);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(buildWebManifest(APP_NAME), null, 2) });
    },
    async closeBundle() {
      files = walk(outDir).map((fileName) => ({ fileName, digest: sha256(readFileSync(join(outDir, fileName))) }));
      const sources = ['sw.ts', 'sw-logic.ts', 'sw-types.ts'].map((n) => readFileSync(here(n), 'utf8'));
      const meta = JSON.parse(readFileSync(here('update-meta.json'), 'utf8')) as { backupFirst?: boolean };
      const manifest = buildManifest(files, sources, sha256, { backupFirst: meta.backupFirst === true });
      await build({
        configFile: false,
        root,
        logLevel: 'warn',
        publicDir: false,
        define: { __PRECACHE_MANIFEST__: JSON.stringify(manifest) },
        build: {
          outDir,
          emptyOutDir: false,
          copyPublicDir: false,
          target: 'es2020',
          lib: { entry: here(mode === 'off' ? 'sw-kill.ts' : 'sw.ts'), formats: ['iife'], name: 'appServiceWorker', fileName: () => 'sw.js' },
        },
      });
      logger?.info(
        mode === 'off'
          ? `offline: kill switch written to ${join(outDir, 'sw.js')}`
          : `offline: sw.js version ${manifest.version}, ${manifest.pages.length} pages, ${manifest.assets.length} files`,
      );
    },
  };
}
