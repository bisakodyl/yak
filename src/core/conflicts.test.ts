import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { type FieldConflict, keepMine, watchConflicts } from './conflicts';

function pair(): { a: Y.Doc; b: Y.Doc; sync(): void } {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const sync = (): void => {
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)), 'remote');
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)), 'remote');
  };
  a.getMap<Y.Map<unknown>>('projects').set('p1', new Y.Map(Object.entries({ name: 'Acme', color: '#111111' })));
  sync();
  return { a, b, sync };
}

const set = (d: Y.Doc, k: string, v: unknown): void => {
  d.getMap<Y.Map<unknown>>('projects').get('p1')?.set(k, v);
};

describe('watchConflicts', () => {
  it('reports a concurrent edit on the device whose value lost, and only there', () => {
    const { a, b, sync } = pair();
    const seenA: FieldConflict[] = [];
    const seenB: FieldConflict[] = [];
    watchConflicts(a, 'projects', (c) => seenA.push(c));
    watchConflicts(b, 'projects', (c) => seenB.push(c));
    set(a, 'name', 'From A');
    set(b, 'name', 'From B');
    sync();
    const winner = a.getMap<Y.Map<unknown>>('projects').get('p1')?.get('name');
    expect(b.getMap<Y.Map<unknown>>('projects').get('p1')?.get('name')).toBe(winner);
    const lost = winner === 'From A' ? seenB : seenA;
    const won = winner === 'From A' ? seenA : seenB;
    expect(won).toEqual([]);
    expect(lost).toHaveLength(1);
    expect(lost[0]).toMatchObject({ field: 'name', recordId: 'p1', theirs: winner });
  });

  it('is quiet for a later edit made with the old value in view, and for different fields', () => {
    const { a, b, sync } = pair();
    const seen: FieldConflict[] = [];
    watchConflicts(b, 'projects', (c) => seen.push(c));
    set(a, 'name', 'Renamed');
    sync();
    set(a, 'color', '#222222');
    set(b, 'name', 'Again');
    sync();
    set(a, 'name', 'Third');
    sync();
    expect(seen).toEqual([]);
  });

  it('keeps mine only while the winner is still in place', () => {
    const { a, b, sync } = pair();
    const seen: FieldConflict[] = [];
    watchConflicts(a, 'projects', (c) => seen.push(c));
    watchConflicts(b, 'projects', (c) => seen.push(c));
    set(a, 'name', 'From A');
    set(b, 'name', 'From B');
    sync();
    const c = seen[0] as FieldConflict;
    expect(keepMine(a, c)).toBe(true);
    expect(a.getMap<Y.Map<unknown>>('projects').get('p1')?.get('name')).toBe(c.mine);
    expect(keepMine(a, { ...c, theirs: 'something else' })).toBe(false);
  });
});
