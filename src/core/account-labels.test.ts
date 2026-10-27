import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { accountLabel, noteSharedSince, setAccountLabel, sharedSince } from './account-labels';

const FP = 'a'.repeat(32);
const SPACE = 'b'.repeat(24);

describe('account labels', () => {
  it('reads nothing from an empty document', () => {
    const doc = new Y.Doc();
    expect(accountLabel(doc, FP)).toBeUndefined();
    expect(accountLabel(undefined, FP)).toBeUndefined();
    expect(sharedSince(doc, SPACE, FP)).toBeUndefined();
  });

  it('sets, trims and clears a label', () => {
    const doc = new Y.Doc();
    setAccountLabel(doc, FP, '  Alice   at   work ');
    expect(accountLabel(doc, FP)).toBe('Alice at work');
    setAccountLabel(doc, FP, '   ');
    expect(accountLabel(doc, FP)).toBeUndefined();
  });

  it('ignores a malformed fingerprint', () => {
    const doc = new Y.Doc();
    setAccountLabel(doc, 'nope', 'x');
    expect(doc.getMap('settings').size).toBe(0);
  });

  it('keeps the first share date', () => {
    const doc = new Y.Doc();
    noteSharedSince(doc, SPACE, FP, '2026-10-01T10:00:00.000Z');
    noteSharedSince(doc, SPACE, FP, '2026-10-05T10:00:00.000Z');
    expect(sharedSince(doc, SPACE, FP)).toBe('2026-10-01T10:00:00.000Z');
  });
});
