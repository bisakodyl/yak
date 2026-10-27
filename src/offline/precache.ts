// Build-time helpers: turn the Vite output into the worker's precache manifest. Pure functions;
// the Vite plugin in build-plugin.ts supplies the file list and the digest.
import { pageKey, type PrecacheManifest } from './sw-logic';

/** Build files that must never be precached: worker scripts, host config, source maps. */
export function isPrecacheable(fileName: string): boolean {
  if (fileName.endsWith('.map')) return false;
  if (fileName === 'sw.js' || fileName === 'probe-sw.js') return false;
  if (fileName.startsWith('_') || fileName.startsWith('.')) return false;
  return true;
}

export interface BuildFile {
  fileName: string;
  /** Content digest (any stable hex string) of the file. */
  digest: string;
}

/**
 * The manifest for one build. The version is a digest over every precached file's name and
 * content plus `extra` (the worker's own source), so it changes when anything shipped changes and
 * stays the same for an identical rebuild.
 */
export function buildManifest(
  files: readonly BuildFile[],
  extra: readonly string[],
  digest: (text: string) => string,
  meta: { backupFirst?: boolean } = {},
): PrecacheManifest {
  const kept = files.filter((f) => isPrecacheable(f.fileName)).sort((a, b) => (a.fileName < b.fileName ? -1 : 1));
  const pages: string[] = [];
  const assets: string[] = [];
  for (const f of kept) {
    if (f.fileName.endsWith('.html')) pages.push(pageKey(f.fileName));
    else assets.push(f.fileName);
  }
  const input = [...kept.map((f) => `${f.fileName}\t${f.digest}`), ...extra.map((e) => `extra\t${digest(e)}`)].join('\n');
  return { version: digest(input + (meta.backupFirst ? '\nbackupFirst' : '')).slice(0, 12), pages: pages.sort(), assets, ...(meta.backupFirst ? { backupFirst: true } : {}) };
}
