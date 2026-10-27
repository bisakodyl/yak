import { beforeEach, describe, expect, it } from 'vitest';
import { changesSeen, hasNewChanges, markChangesSeen, parseChanges } from './changes';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
});

describe('changes', () => {
  it('parses entries newest first', () => {
    const c = parseChanges('# What\'s new\n\n## 2026-10-17: Older\n\n- a\n\n## 2026-10-19: Newer\n\n- b\n- c\n');
    expect(c.map((x) => x.id)).toEqual(['2026-10-19', '2026-10-17']);
    expect(c[0]).toMatchObject({ title: 'Newer', body: '- b\n- c' });
  });
  it('a device with no record starts up to date', () => {
    expect(hasNewChanges('2026-10-19')).toBe(false);
    expect(changesSeen('2026-10-20')).toBe('2026-10-19');
    expect(hasNewChanges('2026-10-20')).toBe(true);
  });
  it('the dot clears once seen', () => {
    store.set('app-changes-seen', '2026-10-17');
    expect(hasNewChanges('2026-10-19')).toBe(true);
    markChangesSeen('2026-10-19');
    expect(hasNewChanges('2026-10-19')).toBe(false);
  });
});
