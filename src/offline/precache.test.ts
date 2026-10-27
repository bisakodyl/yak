import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildManifest, isPrecacheable } from './precache';

const sha = (s: string): string => createHash('sha256').update(s).digest('hex');
const files = [
  { fileName: 'index.html', digest: 'a' },
  { fileName: 'probe.html', digest: 'b' },
  { fileName: 'assets/main-abc.js', digest: 'd' },
  { fileName: 'assets/editor-def.js', digest: 'e' },
  { fileName: 'assets/main-abc.js.map', digest: 'f' },
  { fileName: 'assets/main-123.css', digest: 'g' },
];

describe('isPrecacheable', () => {
  it('drops worker scripts, host config and source maps', () => {
    expect(isPrecacheable('assets/main-abc.js')).toBe(true);
    expect(isPrecacheable('index.html')).toBe(true);
    for (const f of ['sw.js', 'probe-sw.js', '_headers', '_redirects', '.well-known', 'assets/x.js.map']) expect(isPrecacheable(f)).toBe(false);
  });
});

describe('buildManifest', () => {
  it('lists pages by their canonical path and every other file, sorted', () => {
    const m = buildManifest(files, [], sha);
    expect(m.pages).toEqual(['', 'probe']);
    expect(m.assets).toEqual(['assets/editor-def.js', 'assets/main-123.css', 'assets/main-abc.js']);
    expect(m.version).toMatch(/^[0-9a-f]{12}$/);
  });

  it('gives the same version for the same build, in any order', () => {
    expect(buildManifest([...files].reverse(), ['sw'], sha).version).toBe(buildManifest(files, ['sw'], sha).version);
  });

  it('changes the version when a file, a name or the worker source changes', () => {
    const base = buildManifest(files, ['sw'], sha).version;
    const changed = files.map((f) => (f.fileName === 'index.html' ? { ...f, digest: 'z' } : f));
    expect(buildManifest(changed, ['sw'], sha).version).not.toBe(base);
    const renamed = files.map((f) => (f.fileName === 'assets/editor-def.js' ? { ...f, fileName: 'assets/editor-xyz.js' } : f));
    expect(buildManifest(renamed, ['sw'], sha).version).not.toBe(base);
    expect(buildManifest(files, ['sw2'], sha).version).not.toBe(base);
  });

  it('ignores files that are not precached when deriving the version', () => {
    const withMap = buildManifest(files, [], sha).version;
    const withoutMap = buildManifest(files.filter((f) => !f.fileName.endsWith('.map')), [], sha).version;
    expect(withMap).toBe(withoutMap);
  });
});

describe('backupFirst flag (#283)', () => {
  const files = [{ fileName: 'index.html', digest: 'a' }];
  const digest = (t: string): string => `${t.length}-${[...t].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16)}`;
  it('is absent by default, set when asked, and changes the version', () => {
    const off = buildManifest(files, [], digest);
    const on = buildManifest(files, [], digest, { backupFirst: true });
    expect(off.backupFirst).toBeUndefined();
    expect(on.backupFirst).toBe(true);
    expect(on.version).not.toBe(off.version);
  });
});
