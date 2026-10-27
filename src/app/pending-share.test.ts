import { describe, expect, it } from 'vitest';
import { forgetShare, pendingShare, rememberShare } from './pending-share';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe('pending share link (F-324)', () => {
  it('is remembered, then forgotten', () => {
    const s = memory();
    rememberShare(s, 'abc', 0);
    expect(pendingShare(s, 1000)).toBe('abc');
    forgetShare(s);
    expect(pendingShare(s, 1000)).toBeUndefined();
  });
  it('expires with the link, 15 minutes after it was first seen', () => {
    const s = memory();
    rememberShare(s, 'abc', 0);
    rememberShare(s, 'abc', 10 * 60_000);
    expect(pendingShare(s, 14 * 60_000)).toBe('abc');
    expect(pendingShare(s, 15 * 60_000)).toBeUndefined();
  });
  it('a different link replaces it', () => {
    const s = memory();
    rememberShare(s, 'abc', 0);
    rememberShare(s, 'xyz', 5);
    expect(pendingShare(s, 6)).toBe('xyz');
  });
});
