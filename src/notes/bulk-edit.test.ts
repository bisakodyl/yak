import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bulkEdit } from '../core/bulk';
import { addTagTo, deleteNotes, type Docs, moveToFolder, moveToOtherSpace, planFolderMove, removeTagFrom, setDate, setProperties, shiftDate, shiftDateValue } from './bulk-edit';
import { addTag } from './tag-rewrite';
import { buildIndex, createNote, noteText } from './note-store';
import { statusChanges } from './tasks';

const text = (doc: Y.Doc, id: string): string => noteText(doc, id)?.toString() ?? '';
const run = <T>(docs: Docs, fn: Parameters<typeof bulkEdit<T>>[1]) => bulkEdit([...docs.values()], fn);

function setup() {
  const a = new Y.Doc();
  const b = new Y.Doc();
  const docs: Docs = new Map([['a', a], ['b', b]]);
  return { a, b, docs };
}

describe('addTag', () => {
  it('adds to a list, a string, nothing, and skips a note that has the tag', () => {
    expect(addTag('---\ntags:\n  - x\n---\nB', 'y')).toBe('---\ntags:\n  - x\n  - y\n---\nB');
    expect(addTag('---\ntags: x\n---\nB', 'y')).toBe('---\ntags: x y\n---\nB');
    expect(addTag('Plain', 'y')).toBe('---\ntags:\n  - y\n---\nPlain');
    expect(addTag('---\ntags: [x]\n---\nB', 'X')).toBe('---\ntags: [x]\n---\nB');
    expect(addTag('Body #y here', 'Y')).toBe('Body #y here');
  });
});

describe('bulk tags and properties', () => {
  it('adds and removes a tag across spaces, one Undo for each action', () => {
    const { a, b, docs } = setup();
    const n1 = createNote(a, 'One.md', 'one');
    const n2 = createNote(b, 'Two.md', '---\ntags: [client]\n---\ntwo #client');
    const t = [{ spaceId: 'a', id: n1 }, { spaceId: 'b', id: n2 }];
    const added = run(docs, (tx) => addTagTo(docs, t, 'client', tx));
    expect(added.result).toEqual({ changed: 1, skipped: 1 });
    expect(text(a, n1)).toContain('client');
    const removed = run(docs, (tx) => removeTagFrom(docs, t, 'client', tx));
    expect(removed.result.changed).toBe(2);
    expect(text(b, n2)).not.toContain('client');
    removed.undo();
    expect(text(b, n2)).toContain('#client');
    added.undo();
    expect(text(a, n1)).toBe('one');
  });

  it('marks five tasks done with completedDate and undoes them together', () => {
    const { a, docs } = setup();
    const ids = [1, 2, 3, 4, 5].map((i) => createNote(a, `T${i}.md`, `---\ntags: [task]\nstatus: open\n---\nTask ${i}`));
    const t = ids.map((id) => ({ spaceId: 'a', id }));
    const done = run(docs, (tx) => setProperties(docs, t, statusChanges('done', new Date(2026, 9, 17)), tx));
    expect(done.result.changed).toBe(5);
    expect(ids.every((id) => text(a, id).includes('status: done') && text(a, id).includes('completedDate: 2026-10-17'))).toBe(true);
    done.undo();
    expect(ids.every((id) => text(a, id).includes('status: open') && !text(a, id).includes('completedDate'))).toBe(true);
  });
});

describe('dates', () => {
  it('shifts a date value keeping a time part, and only dates', () => {
    expect(shiftDateValue('2026-10-31', 1)).toBe('2026-11-01');
    expect(shiftDateValue('2026-03-01T09:30', -1)).toBe('2026-02-28T09:30');
    expect(shiftDateValue('soon', 1)).toBeNull();
    expect(shiftDateValue(undefined, 1)).toBeNull();
  });

  it('shifts and sets due dates; notes without a date are skipped', () => {
    const { a, docs } = setup();
    const n1 = createNote(a, 'A.md', '---\ndue: 2026-10-20\n---\nx');
    const n2 = createNote(a, 'B.md', '---\ndue: 2026-10-21T08:00\n---\nx');
    const n3 = createNote(a, 'C.md', 'no date');
    const t = [n1, n2, n3].map((id) => ({ spaceId: 'a', id }));
    const r = run(docs, (tx) => shiftDate(docs, t, 'due', 7, tx));
    expect(r.result).toEqual({ changed: 2, skipped: 1 });
    expect(text(a, n1)).toContain('due: 2026-10-27');
    expect(text(a, n2)).toMatch(/due: '?2026-10-28T08:00/);
    r.undo();
    expect(text(a, n1)).toContain('due: 2026-10-20');
    const s = run(docs, (tx) => setDate(docs, t, 'due', '2026-12-01', tx));
    expect(s.result.changed).toBe(3);
    expect(text(a, n3)).toContain('due: 2026-12-01');
    run(docs, (tx) => setDate(docs, t, 'due', null, tx));
    expect(text(a, n1)).not.toContain('due');
  });
});

describe('moving', () => {
  it('plans folder moves one after another, so two notes with one name do not both go', () => {
    const notes = [
      { id: '1', path: 'A/Same.md' },
      { id: '2', path: 'B/Same.md' },
      { id: '3', path: 'C.md' },
    ];
    const plan = planFolderMove(notes, ['1', '2', '3'], 'Z');
    expect(plan.moves.map((m) => m.path)).toEqual(['Z/Same.md', 'Z/C.md']);
    expect(plan.skipped).toBe(1);
    expect(plan.error).toMatch(/already exists/);
  });

  it('moves notes to a folder and keeps links working, with one Undo', () => {
    const { a, docs } = setup();
    const target = createNote(a, 'Plan.md', 'plan');
    const other = createNote(a, 'Other.md', 'see [[Plan]]');
    const r = run(docs, (tx) => moveToFolder(docs, [{ spaceId: 'a', id: target }], 'Archive/2026', 'auto', tx));
    expect(r.result.changed).toBe(1);
    expect(buildIndex(a).byId.get(target)?.path).toBe('Archive/2026/Plan.md');
    expect(buildIndex(a).resolve('Plan', 'Other.md')?.id).toBe(target);
    expect(text(a, other)).toBeTruthy();
    r.undo();
    expect(buildIndex(a).byId.get(target)?.path).toBe('Plan.md');
    expect(text(a, other)).toBe('see [[Plan]]');
  });

  it('moves three notes to another space, links keep resolving, Undo moves them back', () => {
    const { a, b, docs } = setup();
    const ids = ['One', 'Two', 'Three'].map((n) => createNote(a, `${n}.md`, n));
    const keeper = createNote(a, 'Keeper.md', 'links [[One]] [[Two]] [[Three]]');
    const moved = moveToOtherSpace(docs, (id) => (id === 'a' ? 'Alpha' : 'Beta'), ids.map((id) => ({ spaceId: 'a', id })), 'b', 'In', 'auto');
    expect(moved.changed).toBe(3);
    expect(buildIndex(a).notes.map((n) => n.path)).toEqual(['Keeper.md']);
    expect(buildIndex(b).notes.map((n) => n.path).sort()).toEqual(['In/One.md', 'In/Three.md', 'In/Two.md']);
    expect(text(a, keeper)).toBe('links [[Beta:One]] [[Beta:Two]] [[Beta:Three]]');
    moved.undo();
    expect(buildIndex(a).notes.map((n) => n.path).sort()).toEqual(['Keeper.md', 'One.md', 'Three.md', 'Two.md']);
    expect(buildIndex(b).notes).toHaveLength(0);
    expect(text(a, keeper)).toBe('links [[One]] [[Two]] [[Three]]');
  });

  it('deletes notes with one Undo', () => {
    const { a, docs } = setup();
    const n = createNote(a, 'X.md', 'x');
    const r = run(docs, (tx) => deleteNotes(docs, [{ spaceId: 'a', id: n }], tx));
    expect(buildIndex(a).notes).toHaveLength(0);
    r.undo();
    expect(buildIndex(a).notes).toHaveLength(1);
  });
});
