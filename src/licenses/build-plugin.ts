// Vite plugin: after bundling, find the npm packages whose modules ended up in the bundle, read their
// licences, fail the build on a missing or disallowed one, and emit `licenses.json` (the Help page's
// Open source list) and `THIRD-PARTY-LICENSES.txt` beside the bundle. MIT, ISC and Apache-2.0 require
// the notice to travel with copies, and the minified bundle drops the comments that carried it.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { bundledAssets } from './assets';
import { FALLBACK_AUTHOR, FALLBACK_TEXT } from './fallback';
import { ALLOWED_LICENSES, authorFromText, authorName, type LicenseEntry, licenseOf, packageOf, problems, renderText } from './collect';

const firstFile = (dir: string, pattern: RegExp): string => {
  const name = readdirSync(dir).find((n) => pattern.test(n));
  return name ? readFileSync(join(dir, name), 'utf8') : '';
};

function readPackage(dir: string): LicenseEntry {
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>;
  const repo = typeof pkg.repository === 'string' ? pkg.repository : String((pkg.repository as { url?: string } | undefined)?.url ?? '');
  const homepage = String(pkg.homepage ?? '') || repo.replace(/^git\+/, '').replace(/\.git$/, '').replace(/^git:\/\//, 'https://');
  const text = firstFile(dir, /^licen[cs]e(\.(md|txt))?$/i);
  const fallback = FALLBACK_TEXT[String(pkg.name)];
  return {
    name: String(pkg.name),
    version: String(pkg.version),
    license: licenseOf(pkg),
    author: authorName(pkg.author) || authorFromText(text) || FALLBACK_AUTHOR[String(pkg.name)] || '',
    homepage: /^https?:/.test(homepage) ? homepage : '',
    text: text || (fallback && fallback.license === licenseOf(pkg) ? fallback.text : ''),
    notice: firstFile(dir, /^notice(\.(md|txt))?$/i),
  };
}

/** Name, version and licence of every package in the bundle(s), sorted by name; throws on a licence problem. */
export function collectBundled(moduleIds: Iterable<string>): LicenseEntry[] {
  const dirs = new Map<string, string>();
  for (const id of moduleIds) {
    const p = packageOf(id);
    if (p && existsSync(join(p.dir, 'package.json'))) dirs.set(p.dir, p.name);
  }
  return [...dirs.keys()].map(readPackage).sort((a, b) => a.name.localeCompare(b.name));
}

export function licensesPlugin(appName: string, allowed: readonly string[] = ALLOWED_LICENSES): Plugin {
  return {
    name: 'app-licenses',
    apply: 'build',
    generateBundle(_options, bundle) {
      const ids = Object.values(bundle).flatMap((chunk) => (chunk.type === 'chunk' ? Object.keys(chunk.modules) : []));
      const packages = collectBundled(ids);
      const bad = problems(packages, allowed);
      const entries = [...packages, ...bundledAssets(ids)].sort((a, b) => a.name.localeCompare(b.name));
      if (bad.length) this.error(`Licence check failed:\n- ${bad.join('\n- ')}\nA new licence needs an owner decision (docs/decisions/app.md) and an entry in ALLOWED_LICENSES.`);
      this.emitFile({ type: 'asset', fileName: 'licenses.json', source: JSON.stringify(entries) });
      this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-LICENSES.txt', source: renderText(entries, appName) });
    },
  };
}
