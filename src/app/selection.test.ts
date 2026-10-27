import { describe, expect, it } from 'vitest';
import { clickSelect, EMPTY_SELECTION, keepOnly, setMany } from './selection';

const order = ['a', 'b', 'c', 'd', 'e'];
const plain = { shift: false, toggle: false };

describe('clickSelect', () => {
  it('toggles a row and moves the anchor', () => {
    let s = clickSelect(EMPTY_SELECTION, 'b', order, plain);
    expect([...s.keys]).toEqual(['b']);
    expect(s.anchor).toBe('b');
    s = clickSelect(s, 'b', order, plain);
    expect(s.keys.size).toBe(0);
  });

  it('adds rows with the toggle modifier', () => {
    let s = clickSelect(EMPTY_SELECTION, 'a', order, { shift: false, toggle: true });
    s = clickSelect(s, 'c', order, { shift: false, toggle: true });
    expect([...s.keys].sort()).toEqual(['a', 'c']);
  });

  it('selects the range from the anchor with Shift, in either direction, keeping the anchor', () => {
    let s = clickSelect(EMPTY_SELECTION, 'b', order, plain);
    s = clickSelect(s, 'd', order, { shift: true, toggle: false });
    expect([...s.keys].sort()).toEqual(['b', 'c', 'd']);
    expect(s.anchor).toBe('b');
    s = clickSelect(s, 'a', order, { shift: true, toggle: false });
    expect([...s.keys].sort()).toEqual(['a', 'b']);
  });

  it('adds a range to the selection with Shift and Ctrl together', () => {
    let s = clickSelect(EMPTY_SELECTION, 'a', order, plain);
    s = clickSelect(s, 'c', order, { shift: false, toggle: true });
    s = clickSelect(s, 'e', order, { shift: true, toggle: true });
    expect([...s.keys].sort()).toEqual(['a', 'c', 'd', 'e']);
  });

  it('treats Shift without an anchor as a plain click', () => {
    const s = clickSelect(EMPTY_SELECTION, 'c', order, { shift: true, toggle: false });
    expect([...s.keys]).toEqual(['c']);
  });
});

describe('setMany and keepOnly', () => {
  it('selects and deselects a set', () => {
    let s = setMany(EMPTY_SELECTION, ['a', 'b', 'c'], true);
    expect(s.keys.size).toBe(3);
    s = setMany(s, ['b'], false);
    expect([...s.keys].sort()).toEqual(['a', 'c']);
  });

  it('drops rows that are gone', () => {
    const s = keepOnly(setMany(EMPTY_SELECTION, ['a', 'b'], true), new Set(['a']));
    expect([...s.keys]).toEqual(['a']);
  });
});
