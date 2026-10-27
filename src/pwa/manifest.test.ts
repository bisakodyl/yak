import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildWebManifest } from './manifest';

describe('buildWebManifest', () => {
  const m = buildWebManifest('Example');

  it('meets the install criteria', () => {
    expect(m.name).toBe('Example');
    expect(m.short_name).toBe('Example');
    expect(m.display).toBe('standalone');
    expect(m.start_url).toBe('./');
    expect(m.scope).toBe('./');
    const any = m.icons.filter((i) => i.purpose === 'any').map((i) => i.sizes);
    expect(any).toEqual(expect.arrayContaining(['192x192', '512x512']));
    expect(m.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  it('points only at icons that exist in public/', () => {
    for (const i of m.icons) expect(existsSync(new URL(`../../public/${i.src}`, import.meta.url))).toBe(true);
  });
});
