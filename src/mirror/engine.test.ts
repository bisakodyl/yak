import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, createRecord } from '../core/schema';
import { emptyState, folderName, type MirrorSpace, type MirrorState, syncMirror } from './engine';
import { MemoryFs } from './memory-fs';

function addNote(doc: Y.Doc, path: string, text: string): string {
  const now = new Date().toISOString();
  return createRecord(doc, 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
}

function setup(folders = ['Personal']) {
  const fs = new MemoryFs();
  const spaces: MirrorSpace[] = folders.map((folder) => ({ id: `id-${folder}`, folder, doc: new Y.Doc() }));
  const state: MirrorState = emptyState();
  const sync = () => syncMirror(fs, spaces, state);
  const doc = spaces[0]!.doc;
  const live = (d: Y.Doc = doc): Record<string, string> => {
    const out: Record<string, string> = {};
    collection(d, 'notes').forEach((rec) => {
      if (rec.get('deleted') !== true) out[String(rec.get('path'))] = String((rec.get('text') as Y.Text).toString());
    });
    return out;
  };
  const idOf = (path: string, d: Y.Doc = doc): string => {
    let found = '';
    collection(d, 'notes').forEach((rec, id) => {
      if (rec.get('path') === path && rec.get('deleted') !== true) found = id;
    });
    return found;
  };
  const edit = (path: string, text: string, d: Y.Doc = doc): void => {
    const t = collection(d, 'notes').get(idOf(path, d))!.get('text') as Y.Text;
    t.delete(0, t.length);
    t.insert(0, text);
  };
  return { fs, spaces, state, sync, doc, live, idOf, edit };
}

describe('mirror engine', () => {
  it('writes a new note to a file, and a new file to a note', async () => {
    const t = setup();
    addNote(t.doc, 'Ideas/Plan.md', 'one');
    await t.fs.write('Personal/Inbox.md', 'from outside');
    await t.fs.write('Personal/image.png', 'ignored');
    await t.fs.write('Personal/.hidden.md', 'ignored');
    await t.fs.write('Stray.md', 'outside any space');
    const report = await t.sync();
    expect(report.errors).toEqual([]);
    expect(t.fs.text('Personal/Ideas/Plan.md')).toBe('one');
    expect(t.live()).toEqual({ 'Ideas/Plan.md': 'one', 'Inbox.md': 'from outside' });
  });

  it('reports a note path that is not portable and writes nothing', async () => {
    const t = setup();
    for (const path of ['a\\..\\..\\Other.md', 'CON.md', 'Dir/aux.md', 'x\u0000y.md', 'dir ./x.md']) addNote(t.doc, path, 'x');
    await t.fs.write('Personal/NUL.md', 'reserved on disk');
    const before = (await t.fs.list()).map((f) => f.path).sort();
    const report = await t.sync();
    expect(report.errors.length).toBeGreaterThan(0);
    expect((await t.fs.list()).map((f) => f.path).sort()).toEqual(before);
    expect(t.live()).not.toHaveProperty('NUL.md');
  });

  it('carries an edit on each side across, and is quiet when nothing changed', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    addNote(t.doc, 'B.md', 'beta');
    await t.sync();
    t.edit('A.md', 'alpha!');
    await t.fs.write('Personal/B.md', 'beta?');
    await t.sync();
    expect(t.fs.text('Personal/A.md')).toBe('alpha!');
    expect(t.live()).toEqual({ 'A.md': 'alpha!', 'B.md': 'beta?' });
    const before = JSON.stringify(t.state);
    await t.sync();
    expect(JSON.stringify(t.state)).toBe(before);
  });

  it('applies an outside edit as a small edit, so a concurrent edit elsewhere in the note merges', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'top\n\nmiddle\n\nbottom');
    await t.sync();
    await t.fs.write('Personal/A.md', 'top\n\nmiddle\n\nbottom line');
    // Another device edits the top at the same time; its update arrives as a Yjs update.
    const other = new Y.Doc();
    Y.applyUpdate(other, Y.encodeStateAsUpdate(t.doc));
    (collection(other, 'notes').get(t.idOf('A.md'))!.get('text') as Y.Text).insert(0, 'TOP ');
    await t.sync();
    Y.applyUpdate(t.doc, Y.encodeStateAsUpdate(other));
    expect(t.live()['A.md']).toBe('TOP top\n\nmiddle\n\nbottom line');
  });

  it('follows renames and moves both ways', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    addNote(t.doc, 'B.md', 'beta');
    await t.sync();
    const idA = t.idOf('A.md');
    collection(t.doc, 'notes').get(idA)!.set('path', 'Archive/A2.md');
    await t.fs.rename('Personal/B.md', 'Personal/Moved/B.md');
    await t.sync();
    expect(t.fs.paths()).toEqual(['Personal/Archive/A2.md', 'Personal/Moved/B.md']);
    expect(t.live()).toEqual({ 'Archive/A2.md': 'alpha', 'Moved/B.md': 'beta' });
    expect(t.idOf('Archive/A2.md')).toBe(idA);
  });

  it('follows deletes both ways', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    addNote(t.doc, 'B.md', 'beta');
    await t.sync();
    collection(t.doc, 'notes').get(t.idOf('A.md'))!.set('deleted', true);
    await t.fs.delete('Personal/B.md');
    await t.sync();
    expect(t.fs.paths()).toEqual([]);
    expect(t.live()).toEqual({});
    // Soft delete: the record is still there.
    expect(collection(t.doc, 'notes').size).toBe(2);
  });

  it('keeps an edit when the other side deleted the note', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    addNote(t.doc, 'B.md', 'beta');
    await t.sync();
    t.edit('A.md', 'alpha edited');
    await t.fs.delete('Personal/A.md');
    collection(t.doc, 'notes').get(t.idOf('B.md'))!.set('deleted', true);
    await t.fs.write('Personal/B.md', 'beta edited');
    await t.sync();
    expect(t.fs.text('Personal/A.md')).toBe('alpha edited');
    expect(t.live()).toEqual({ 'A.md': 'alpha edited', 'B.md': 'beta edited' });
  });

  it('keeps a conflict copy when both sides changed', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    await t.sync();
    t.edit('A.md', 'from the app');
    await t.fs.write('Personal/A.md', 'from outside');
    const report = await t.sync();
    expect(report.conflicts).toEqual(['Personal/A (conflict).md']);
    expect(t.fs.text('Personal/A.md')).toBe('from the app');
    expect(t.fs.text('Personal/A (conflict).md')).toBe('from outside');
    expect(t.live()).toEqual({ 'A.md': 'from the app', 'A (conflict).md': 'from outside' });
    expect((await t.sync()).conflicts).toEqual([]);
  });

  it('is not a conflict when both sides made the same change', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    await t.sync();
    t.edit('A.md', 'same');
    await t.fs.write('Personal/A.md', 'same');
    expect((await t.sync()).conflicts).toEqual([]);
    expect(t.fs.paths()).toEqual(['Personal/A.md']);
  });

  it('keeps both when a note and a file are created at one path', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'note side');
    await t.fs.write('Personal/A.md', 'file side');
    await t.sync();
    expect(t.live()).toEqual({ 'A 2.md': 'note side', 'A.md': 'file side' });
    expect(t.fs.text('Personal/A 2.md')).toBe('note side');
  });

  it('keeps one folder per space', async () => {
    const t = setup(['Personal', 'Work']);
    const work = t.spaces[1]!.doc;
    addNote(t.doc, 'Same.md', 'personal');
    addNote(work, 'Same.md', 'work');
    await t.sync();
    expect(t.fs.paths()).toEqual(['Personal/Same.md', 'Work/Same.md']);
    await t.fs.write('Work/Same.md', 'work edited');
    await t.fs.write('Work/New.md', 'new');
    await t.sync();
    expect(t.live()).toEqual({ 'Same.md': 'personal' });
    expect(t.live(work)).toEqual({ 'Same.md': 'work edited', 'New.md': 'new' });
  });

  it('keeps task front matter byte for byte', async () => {
    const t = setup();
    const task = '---\ntitle: Pay rent\nstatus: open\ntags: [task]\ndue: 2026-11-01\n---\nBody\n';
    addNote(t.doc, 'Tasks/Pay rent.md', task);
    await t.sync();
    expect(t.fs.text('Personal/Tasks/Pay rent.md')).toBe(task);
    await t.fs.write('Personal/Tasks/Pay rent.md', task.replace('status: open', 'status: done'));
    await t.sync();
    expect(t.live()['Tasks/Pay rent.md']).toContain('status: done');
  });

  it('survives a state saved as JSON between passes', async () => {
    const t = setup();
    addNote(t.doc, 'A.md', 'alpha');
    await t.sync();
    const restored: MirrorState = JSON.parse(JSON.stringify(t.state));
    await t.fs.write('Personal/A.md', 'beta');
    await syncMirror(t.fs, t.spaces, restored);
    expect(t.live()).toEqual({ 'A.md': 'beta' });
  });
});

describe('folderName', () => {
  it('makes a space name safe as a folder', () => {
    expect(folderName('Work: 2026/27')).toBe('Work- 2026-27');
    expect(folderName('')).toBe('Space');
  });
});
