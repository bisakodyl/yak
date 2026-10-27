import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bulkEdit } from '../core/bulk';
import { createClient, createProject, liveProjects, uniqueTagNames } from './catalog';
import { addManualEntry, liveEntries, startTimer } from './entries';
import { deleteAll, moveToSpace, type Spaces, setBillable, setDate, setProject, setTag, shiftDays } from './bulk-edit';
import { at, makeSpaceDocs } from './testing';

/** Two spaces; in tests one document holds both the catalog and the entries. */
function setup() {
  const docs = makeSpaceDocs();
  const spaces: Spaces = new Map([...docs].map(([id, d]) => [id, { doc: d, privateDoc: d }]));
  const p = docs.get('personal')!;
  const w = docs.get('work')!;
  const add = (doc: Y.Doc, desc: string, day: number, extra: Record<string, unknown> = {}) => {
    const r = addManualEntry(doc, 'dev', { start: at(2026, 10, day, 9), stop: at(2026, 10, day, 10), description: desc, ...extra });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  };
  return { docs, spaces, p, w, add };
}
const run = <T>(spaces: Spaces, fn: Parameters<typeof bulkEdit<T>>[1]) => bulkEdit([...spaces.values()].flatMap((h) => [h.doc, h.privateDoc]), fn);

describe('bulk edit of entries', () => {
  it('shifts dates by whole days, keeping times and duration, and one Undo restores all', () => {
    const { spaces, p, add } = setup();
    const a = add(p, 'a', 1);
    const b = add(p, 'b', 2);
    const { result, undo } = run(spaces, (tx) => shiftDays(spaces, [{ spaceId: 'personal', id: a }, { spaceId: 'personal', id: b }], 3, tx));
    expect(result).toEqual({ changed: 2, skipped: 0 });
    const e = liveEntries(p).find((x) => x.id === a)!;
    expect(new Date(e.start).getTime()).toBe(at(2026, 10, 4, 9));
    expect(e.duration).toBe(3600);
    undo();
    expect(new Date(liveEntries(p).find((x) => x.id === a)!.start).getTime()).toBe(at(2026, 10, 1, 9));
  });

  it('shifts across a daylight-saving change keeping the wall-clock time', () => {
    const { spaces, p, add } = setup();
    const id = add(p, 'dst', 1);
    run(spaces, (tx) => shiftDays(spaces, [{ spaceId: 'personal', id }], 60, tx));
    const d = new Date(liveEntries(p)[0]!.start);
    expect(d.getHours()).toBe(9);
  });

  it('sets one date and keeps each time of day', () => {
    const { spaces, p, add } = setup();
    const a = add(p, 'a', 1);
    const b = add(p, 'b', 20);
    run(spaces, (tx) => setDate(spaces, [{ spaceId: 'personal', id: a }, { spaceId: 'personal', id: b }], '2026-11-05', tx));
    for (const e of liveEntries(p)) {
      expect(new Date(e.start).getTime()).toBe(at(2026, 11, 5, 9));
      expect(new Date(e.stop as string).getTime()).toBe(at(2026, 11, 5, 10));
    }
  });

  it('skips running entries', () => {
    const { spaces, p, add } = setup();
    const a = add(p, 'a', 1);
    const running = startTimer(new Map([['personal', p]]), 'personal', 'dev', { description: 'now' }).id;
    const r = run(spaces, (tx) => setBillable(spaces, [{ spaceId: 'personal', id: a }, { spaceId: 'personal', id: running }], true, tx)).result;
    expect(r).toEqual({ changed: 1, skipped: 1 });
  });

  it('sets a project by name in each entry\'s own space and skips where it does not exist', () => {
    const { spaces, p, w, add } = setup();
    const pa = createProject(p, { name: 'Site', billable: true })!;
    createProject(w, { name: 'Other' });
    const a = add(p, 'a', 1);
    const b = add(w, 'b', 1);
    const r = run(spaces, (tx) => setProject(spaces, [{ spaceId: 'personal', id: a }, { spaceId: 'work', id: b }], 'site', tx)).result;
    expect(r).toEqual({ changed: 1, skipped: 1 });
    const e = liveEntries(p)[0]!;
    expect(e.project_id).toBe(pa);
    expect(e.billable).toBe(true);
    run(spaces, (tx) => setProject(spaces, [{ spaceId: 'personal', id: a }], null, tx));
    expect(liveEntries(p)[0]!.project_id).toBeNull();
  });

  it('adds and removes a tag, making it in the space', () => {
    const { spaces, p, add } = setup();
    const a = add(p, 'a', 1, { tags: ['keep'] });
    const b = add(p, 'b', 2);
    const t = [{ spaceId: 'personal', id: a }, { spaceId: 'personal', id: b }];
    expect(run(spaces, (tx) => setTag(spaces, t, 'Review', true, tx)).result.changed).toBe(2);
    expect(uniqueTagNames(p)).toContain('Review');
    expect(liveEntries(p).every((e) => e.tags.includes('Review'))).toBe(true);
    expect(run(spaces, (tx) => setTag(spaces, t, 'review', false, tx)).result.changed).toBe(2);
    expect(liveEntries(p).find((e) => e.id === a)!.tags).toEqual(['keep']);
    // Already without it: nothing changes.
    expect(run(spaces, (tx) => setTag(spaces, t, 'review', false, tx)).result.changed).toBe(0);
  });

  it('deletes with the restore stamp, and Undo brings them back', () => {
    const { spaces, p, add } = setup();
    const a = add(p, 'a', 1);
    const { undo } = run(spaces, (tx) => deleteAll(spaces, [{ spaceId: 'personal', id: a }], tx));
    expect(liveEntries(p)).toHaveLength(0);
    expect((p.getMap('time_entries').get(a) as Y.Map<unknown>).get('deleted_at')).toBeTypeOf('string');
    undo();
    expect(liveEntries(p)).toHaveLength(1);
  });

  it('moves entries to another space: the project follows by name (made when missing), tags are made, no copy is left', () => {
    const { spaces, p, w, add } = setup();
    const client = createClient(p, 'Initech')!;
    const proj = createProject(p, { name: 'Reports', client_id: client, billable: true })!;
    const a = add(p, 'a', 1, { project_id: proj, tags: ['deep'] });
    const b = add(p, 'b', 2);
    const { result, undo } = run(spaces, (tx) => moveToSpace(spaces, [{ spaceId: 'personal', id: a }, { spaceId: 'personal', id: b }, { spaceId: 'work', id: 'x' }], 'work', 'dev', tx));
    expect(result.changed).toBe(2);
    expect(liveEntries(p)).toHaveLength(0);
    const moved = liveEntries(w);
    expect(moved.map((e) => e.description).sort()).toEqual(['a', 'b']);
    const made = liveProjects(w).find((x) => x.name === 'Reports')!;
    expect(moved.find((e) => e.description === 'a')!.project_id).toBe(made.id);
    expect(uniqueTagNames(w)).toContain('deep');
    undo();
    expect(liveEntries(p)).toHaveLength(2);
    expect(liveEntries(w)).toHaveLength(0);
    // The deleted original cannot be restored from "Recently deleted" (no stamp) while moved.
  });

  it('reuses a project of the same name in the target space', () => {
    const { spaces, p, w, add } = setup();
    const here = createProject(p, { name: 'Same' })!;
    const there = createProject(w, { name: 'same' })!;
    const a = add(p, 'a', 1, { project_id: here });
    run(spaces, (tx) => moveToSpace(spaces, [{ spaceId: 'personal', id: a }], 'work', 'dev', tx));
    expect(liveEntries(w)[0]!.project_id).toBe(there);
    expect(liveProjects(w)).toHaveLength(1);
  });
});
