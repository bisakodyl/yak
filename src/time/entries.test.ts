import { describe, expect, it } from 'vitest';
import { collection } from '../core/schema';
import { createProject } from './catalog';
import {
  addManualEntry,
  canRestore,
  deleteEntry,
  RESTORE_WINDOW_MS,
  recentlyDeleted,
  restoreEntry,
  editEntry,
  entryDuration,
  findRunning,
  liveEntries,
  recentDescriptions,
  splitEntry,
  startTimer,
  stopTimer,
} from './entries';
import { at, makeSpaceDocs, syncDevices } from './testing';

const T0 = at(2026, 10, 14, 9, 0);

describe('start and stop', () => {
  it('creates a running entry with the Toggl-shaped fields', () => {
    const docs = makeSpaceDocs();
    const { id } = startTimer(docs, 'personal', 'dev-1', { description: 'write', tags: ['a'] }, T0);
    const e = liveEntries(docs.get('personal')!)[0]!;
    expect(e.id).toBe(id);
    expect(e).toMatchObject({ description: 'write', stop: null, duration: 0, tags: ['a'], device_id: 'dev-1', deleted: false });
    expect(e.start).toBe(new Date(T0).toISOString());
    expect(entryDuration(e, T0 + 90_000)).toBe(90);
  });

  it('stopping records stop and duration', () => {
    const docs = makeSpaceDocs();
    const { id } = startTimer(docs, 'personal', 'd', {}, T0);
    expect(stopTimer(docs.get('personal')!, id, T0 + 3_725_000)).toBe(true);
    const e = liveEntries(docs.get('personal')!)[0]!;
    expect(e.duration).toBe(3725);
    expect(e.stop).toBe(new Date(T0 + 3_725_000).toISOString());
    expect(findRunning(docs)).toHaveLength(0);
  });

  it('starting stops a timer running in any space, at the new start', () => {
    const docs = makeSpaceDocs();
    const first = startTimer(docs, 'personal', 'd', { description: 'one' }, T0);
    const second = startTimer(docs, 'work', 'd', { description: 'two' }, T0 + 600_000);
    expect(second.stopped.map((s) => s.id)).toEqual([first.id]);
    const running = findRunning(docs);
    expect(running.map((r) => r.id)).toEqual([second.id]);
    const old = liveEntries(docs.get('personal')!)[0]!;
    expect(old.duration).toBe(600);
  });

  it('takes billable from the project unless given', () => {
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    const pid = createProject(doc, { name: 'P', billable: true })!;
    startTimer(docs, 'personal', 'd', { project_id: pid }, T0);
    startTimer(docs, 'personal', 'd', { project_id: pid, billable: false }, T0 + 1000);
    const es = liveEntries(doc).sort((a, b) => a.start.localeCompare(b.start));
    expect(es.map((e) => e.billable)).toEqual([true, false]);
  });
});

describe('manual entries and edits', () => {
  it('adds a manual entry and rejects a backwards range', () => {
    const doc = makeSpaceDocs().get('personal')!;
    const r = addManualEntry(doc, 'd', { start: T0, stop: T0 + 5400_000, description: 'x' });
    expect(r.ok).toBe(true);
    expect(liveEntries(doc)[0]!.duration).toBe(5400);
    expect(addManualEntry(doc, 'd', { start: T0, stop: T0 - 1 }).ok).toBe(false);
    expect(liveEntries(doc)).toHaveLength(1);
  });

  it('edits fields and recomputes the duration', () => {
    const doc = makeSpaceDocs().get('personal')!;
    const r = addManualEntry(doc, 'd', { start: T0, stop: T0 + 3600_000 });
    if (!r.ok) throw new Error('add failed');
    expect(editEntry(doc, r.id, { description: 'new', tags: [' a ', 'A', 'b'], stop: T0 + 7200_000 }).ok).toBe(true);
    const e = liveEntries(doc)[0]!;
    expect(e).toMatchObject({ description: 'new', tags: ['a', 'b'], duration: 7200 });
    expect(editEntry(doc, r.id, { start: T0 + 8000_000 }).ok).toBe(false);
    expect(editEntry(doc, r.id, { stop: null }).ok).toBe(false);
    expect(editEntry(doc, 'missing', { description: 'x' }).ok).toBe(false);
  });

  it('setting a stop time stops a running entry', () => {
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    const { id } = startTimer(docs, 'personal', 'd', {}, T0);
    expect(editEntry(doc, id, { stop: T0 + 60_000 }).ok).toBe(true);
    expect(findRunning(docs)).toHaveLength(0);
    expect(liveEntries(doc)[0]!.duration).toBe(60);
  });
});

describe('split and delete', () => {
  it('splits a stopped entry into two that add up', () => {
    const doc = makeSpaceDocs().get('personal')!;
    const r = addManualEntry(doc, 'd', { start: T0, stop: T0 + 4000_000, description: 'x', tags: ['t'], billable: true });
    if (!r.ok) throw new Error();
    const s = splitEntry(doc, 'd2', r.id, T0 + 1000_000);
    expect(s.ok).toBe(true);
    const es = liveEntries(doc).sort((a, b) => a.start.localeCompare(b.start));
    expect(es.map((e) => e.duration)).toEqual([1000, 3000]);
    expect(es[1]).toMatchObject({ description: 'x', tags: ['t'], billable: true, device_id: 'd2' });
    expect(es[0]!.stop).toBe(es[1]!.start);
  });

  it('rejects splits outside the entry', () => {
    const doc = makeSpaceDocs().get('personal')!;
    const r = addManualEntry(doc, 'd', { start: T0, stop: T0 + 1000_000 });
    if (!r.ok) throw new Error();
    expect(splitEntry(doc, 'd', r.id, T0).ok).toBe(false);
    expect(splitEntry(doc, 'd', r.id, T0 + 1000_000).ok).toBe(false);
    expect(splitEntry(doc, 'd', 'nope', T0 + 5).ok).toBe(false);
  });

  it('splitting a running entry leaves the second part running', () => {
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    const { id } = startTimer(docs, 'personal', 'd', { description: 'r' }, T0);
    const s = splitEntry(doc, 'd', id, T0 + 600_000, T0 + 900_000);
    if (!s.ok) throw new Error();
    const running = findRunning(docs);
    expect(running.map((r) => r.id)).toEqual([s.id]);
    expect(liveEntries(doc).find((e) => e.id === id)!.duration).toBe(600);
  });

  it('soft deletes and never leaves a deleted running entry', () => {
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    const { id } = startTimer(docs, 'personal', 'd', {}, T0);
    expect(deleteEntry(doc, id, T0 + 1000)).toBe(true);
    expect(liveEntries(doc)).toHaveLength(0);
    expect(findRunning(docs)).toHaveLength(0);
    expect(collection(doc, 'time_entries').get(id)?.get('deleted')).toBe(true);
  });
});

describe('undo a delete within the restore window', () => {
  it('restores within the window, stopped, and lists what can be restored', () => {
    const docs = makeSpaceDocs();
    const doc = docs.get('personal')!;
    const { id } = startTimer(docs, 'personal', 'd', { description: 'oops' }, T0);
    const kept = addManualEntry(doc, 'd', { start: T0 - 7200_000, stop: T0 - 3600_000, description: 'other' });
    if (!kept.ok) throw new Error();
    deleteEntry(doc, kept.id, T0 + 500);
    deleteEntry(doc, id, T0 + 1000);
    expect(recentlyDeleted(doc, T0 + 2000).map((e) => e.id)).toEqual([id, kept.id]);
    expect(restoreEntry(doc, id, T0 + RESTORE_WINDOW_MS - 1)).toEqual({ ok: true });
    const back = liveEntries(doc).find((e) => e.id === id)!;
    expect(back.description).toBe('oops');
    expect(back.stop).not.toBeNull();
    expect(back.deleted_at).toBeNull();
    expect(findRunning(docs)).toHaveLength(0);
    expect(recentlyDeleted(doc, T0 + 2000).map((e) => e.id)).toEqual([kept.id]);
  });

  it('refuses after the window, and for deletes without a stamp', () => {
    const doc = makeSpaceDocs().get('personal')!;
    const r = addManualEntry(doc, 'd', { start: T0, stop: T0 + 1000 });
    if (!r.ok) throw new Error();
    deleteEntry(doc, r.id, T0 + 2000);
    expect(restoreEntry(doc, r.id, T0 + 2000 + RESTORE_WINDOW_MS).ok).toBe(false);
    expect(recentlyDeleted(doc, T0 + 2000 + RESTORE_WINDOW_MS)).toEqual([]);
    expect(canRestore({ deleted: true, deleted_at: undefined }, T0)).toBe(false);
    expect(canRestore({ deleted: false, deleted_at: new Date(T0).toISOString() }, T0)).toBe(false);
    expect(restoreEntry(doc, 'missing', T0).ok).toBe(false);
  });

  it('converges when one device restores while another edits the deleted entry', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    const r = addManualEntry(a.get('personal')!, 'a', { start: T0, stop: T0 + 1000, description: 'x' });
    if (!r.ok) throw new Error();
    deleteEntry(a.get('personal')!, r.id, T0 + 2000);
    syncDevices(a, b);
    restoreEntry(a.get('personal')!, r.id, T0 + 3000);
    editEntry(b.get('personal')!, r.id, { description: 'edited offline' });
    syncDevices(a, b);
    const ea = collection(a.get('personal')!, 'time_entries').get(r.id)!.toJSON();
    const eb = collection(b.get('personal')!, 'time_entries').get(r.id)!.toJSON();
    expect(ea).toEqual(eb);
    expect(ea.deleted).toBe(false);
    expect(ea.description).toBe('edited offline');
  });
});

describe('suggestions', () => {
  it('lists distinct recent descriptions, newest first', () => {
    const doc = makeSpaceDocs().get('personal')!;
    addManualEntry(doc, 'd', { start: T0, stop: T0 + 1000, description: 'alpha' });
    addManualEntry(doc, 'd', { start: T0 + 5000, stop: T0 + 6000, description: 'Beta' });
    addManualEntry(doc, 'd', { start: T0 + 9000, stop: T0 + 9500, description: 'ALPHA' });
    addManualEntry(doc, 'd', { start: T0 + 9800, stop: T0 + 9900, description: '' });
    expect(recentDescriptions(liveEntries(doc)).map((e) => e.description)).toEqual(['ALPHA', 'Beta']);
  });
});

describe('entries in a separate time document', () => {
  it('reads the billable default from the main document and writes the entry to the time document', async () => {
    const Y = await import('yjs');
    const { createRecord, collection } = await import('../core/schema');
    const { startTimer } = await import('./entries');
    const main = new Y.Doc();
    const time = new Y.Doc();
    const projectId = createRecord(main, 'projects', { name: 'Billable', client_id: null, color: '#336699', billable: true, rate: null, currency: 'USD', active: true, deleted: false });
    const { id } = startTimer(new Map([['work', time]]), 'work', 'dev', { project_id: projectId }, Date.now(), new Map([['work', main]]));
    expect(collection(time, 'time_entries').get(id)?.get('billable')).toBe(true);
    expect(collection(main, 'time_entries').size).toBe(0);
  });
});
