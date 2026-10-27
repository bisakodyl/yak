import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addSpace } from './account';
import { declineUndecided, decided, hasChosen, keepAll, keeps, keepUndecided, keptSpaces, setKeeps } from './keeps';

const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('keeps', () => {
  it('keeps nothing until the document says so', () => {
    const doc = new Y.Doc();
    expect(keeps(doc, 'phone', 'work')).toBe(false);
    expect(hasChosen(doc, 'phone')).toBe(false);
    setKeeps(doc, 'phone', 'work', true);
    expect(keeps(doc, 'phone', 'work')).toBe(true);
    expect(keeps(doc, 'phone', 'personal')).toBe(false);
    expect(hasChosen(doc, 'phone')).toBe(true);
    setKeeps(doc, 'phone', 'work', false);
    expect(keeps(doc, 'phone', 'work')).toBe(false);
    expect(hasChosen(doc, 'phone')).toBe(true);
  });

  it('lists the kept spaces of a device, and keeps several at once', () => {
    const doc = new Y.Doc();
    keepAll(doc, 'laptop', ['a', 'b', 'c']);
    setKeeps(doc, 'laptop', 'b', false);
    expect(keptSpaces(doc, 'laptop', ['a', 'b', 'c', 'd'])).toEqual(['a', 'c']);
    expect(keptSpaces(doc, 'phone', ['a', 'b'])).toEqual([]);
  });

  it('merges two devices choosing at the same time without losing either choice', () => {
    const laptop = new Y.Doc();
    const phone = new Y.Doc();
    keepAll(laptop, 'laptop', ['a', 'b']);
    keepAll(phone, 'phone', ['a']);
    sync(laptop, phone);
    for (const doc of [laptop, phone]) {
      expect(keptSpaces(doc, 'laptop', ['a', 'b'])).toEqual(['a', 'b']);
      expect(keptSpaces(doc, 'phone', ['a', 'b'])).toEqual(['a']);
    }
  });

  it('lets the device that creates a space keep it, and nobody else', () => {
    const doc = new Y.Doc();
    expect(addSpace(doc, 'ws1', 'Work', '2026-10-17T00:00:00.000Z', 'laptop')).toBeUndefined();
    expect(keeps(doc, 'laptop', 'ws1')).toBe(true);
    expect(keeps(doc, 'phone', 'ws1')).toBe(false);
  });

  it('tells a space a device said no to from one it has not decided on, and keeps only the undecided', () => {
    const doc = new Y.Doc();
    setKeeps(doc, 'phone', 'a', false);
    expect(decided(doc, 'phone', 'a')).toBe(true);
    expect(decided(doc, 'phone', 'b')).toBe(false);
    keepUndecided(doc, 'phone', ['a', 'b', 'c']);
    expect(keptSpaces(doc, 'phone', ['a', 'b', 'c'])).toEqual(['b', 'c']);
  });

  it('declines the undecided spaces as decided no, and leaves a yes alone', () => {
    const doc = new Y.Doc();
    setKeeps(doc, 'phone', 'a', true);
    declineUndecided(doc, 'phone', ['a', 'b', 'c']);
    expect(keptSpaces(doc, 'phone', ['a', 'b', 'c'])).toEqual(['a']);
    expect(decided(doc, 'phone', 'b')).toBe(true);
    expect(decided(doc, 'phone', 'c')).toBe(true);
  });
});
