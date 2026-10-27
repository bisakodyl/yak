import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addSpace } from '../core/account';
import { keeps } from '../core/keeps';
import { initKeeps, KEEPS_FLAG } from './keeps-init';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

function account(): Y.Doc {
  const doc = new Y.Doc();
  addSpace(doc, 'p1', 'Personal', '1');
  addSpace(doc, 'w1', 'Work', '2');
  return doc;
}

describe('initKeeps', () => {
  it('makes this device keep the spaces of its account, once', () => {
    const doc = account();
    const storage = memory();
    expect(initKeeps(doc, 'me', storage)).toBe(true);
    expect(keeps(doc, 'me', 'p1') && keeps(doc, 'me', 'w1')).toBe(true);
    expect(storage.m.has(KEEPS_FLAG)).toBe(true);
    // A space added later is not kept automatically by a second start.
    addSpace(doc, 'x1', 'Extra', '3');
    expect(initKeeps(doc, 'me', storage)).toBe(false);
    expect(keeps(doc, 'me', 'x1')).toBe(false);
  });

  it('lets devices it already syncs with keep everything, unless a per-pair list limited them', () => {
    const doc = account();
    initKeeps(doc, 'me', memory(), { peers: ['laptop', 'phone'], peerSpaces: { phone: ['w1'] } });
    expect(keeps(doc, 'laptop', 'p1') && keeps(doc, 'laptop', 'w1')).toBe(true);
    expect(keeps(doc, 'phone', 'w1')).toBe(true);
    expect(keeps(doc, 'phone', 'p1')).toBe(false);
  });

  it('ignores per-pair lists that name spaces which no longer exist', () => {
    const doc = account();
    initKeeps(doc, 'me', memory(), { peers: ['phone'], peerSpaces: { phone: ['personal', 'work'] } });
    expect(keeps(doc, 'phone', 'p1')).toBe(false);
    expect(keeps(doc, 'phone', 'w1')).toBe(false);
  });
});
