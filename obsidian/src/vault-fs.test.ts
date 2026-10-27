import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { listAttachments } from '../../src/core/blobs/attachments';
import { MemoryBlobStore } from '../../src/core/blobs/store';
import { collection, createRecord } from '../../src/core/schema';
import { emptyState, syncMirror, type MirrorSpace } from '../../src/mirror/engine';
import type { LinkSpace } from './links';
import { relinkFiles } from './relink';
import { VaultFs } from './vault-fs';
import { MemoryVault } from './vault-port';

function addNote(doc: Y.Doc, path: string, text: string): void {
  const now = new Date().toISOString();
  createRecord(doc, 'notes', { path, text: new Y.Text(text), created_at: now, updated_at: now, deleted: false });
}

function noteTexts(doc: Y.Doc): Record<string, string> {
  const out: Record<string, string> = {};
  collection(doc, 'notes').forEach((rec) => {
    if (rec.get('deleted') !== true) out[String(rec.get('path'))] = (rec.get('text') as Y.Text).toString();
  });
  return out;
}

function setup() {
  const vault = new MemoryVault();
  const personal: MirrorSpace = { id: 'p', folder: 'Personal', doc: new Y.Doc() };
  const work: MirrorSpace = { id: 'w', folder: 'Work', doc: new Y.Doc() };
  const spaces = [personal, work];
  const linkSpaces = (): LinkSpace[] =>
    [[personal, 'Personal'], [work, 'Work']].map(([s, name]) => {
      const sp = s as MirrorSpace;
      return { id: sp.id, name: name as string, folder: sp.folder, paths: Object.keys(noteTexts(sp.doc)) };
    });
  const fs = new VaultFs(vault, 'Yak', linkSpaces);
  const state = emptyState();
  return { vault, personal, work, fs, state, run: () => syncMirror(fs, spaces, state) };
}

describe('vault file system', () => {
  it('writes notes under the root and reads vault edits back', async () => {
    const t = setup();
    addNote(t.personal.doc, 'Ideas/Plan.md', 'one');
    expect((await t.run()).errors).toEqual([]);
    expect(t.vault.text('Yak/Personal/Ideas/Plan.md')).toBe('one');
    t.vault.put('Yak/Personal/Ideas/Plan.md', 'two');
    t.vault.put('Yak/Work/New.md', 'fresh');
    await t.run();
    expect(noteTexts(t.personal.doc)).toEqual({ 'Ideas/Plan.md': 'two' });
    expect(noteTexts(t.work.doc)).toEqual({ 'New.md': 'fresh' });
  });

  it('touches nothing outside the root', async () => {
    const t = setup();
    t.vault.put('Daily/2026-10-17.md', 'mine');
    t.vault.put('.obsidian/app.json', '{}');
    t.vault.put('Yak/Personal/pic.png', 'x');
    addNote(t.personal.doc, 'A.md', 'a');
    await t.run();
    expect(t.vault.text('Daily/2026-10-17.md')).toBe('mine');
    expect(noteTexts(t.personal.doc)).toEqual({ 'A.md': 'a' });
    expect(t.vault.trashed).toEqual([]);
  });

  it('ignores vault files with backslash or reserved names, and writes none for such notes', async () => {
    const t = setup();
    t.vault.put('Yak/Personal/a\\..\\..\\Other.md', 'x');
    t.vault.put('Yak/Personal/CON.md', 'x');
    addNote(t.personal.doc, 'b\\c.md', 'y');
    const report = await t.run();
    expect(report.errors.length).toBeGreaterThan(0);
    expect(noteTexts(t.personal.doc)).toEqual({ 'b\\c.md': 'y' });
    expect(t.vault.files().map((f) => f.path).sort()).toEqual(['Yak/Personal/CON.md', 'Yak/Personal/a\\..\\..\\Other.md']);
  });

  it('writes a cross-space link as a vault path and reads it back as the same note text', async () => {
    const t = setup();
    addNote(t.work.doc, 'Acme/Brief.md', 'brief');
    addNote(t.personal.doc, 'Home.md', 'To [[Work:Acme/Brief]]');
    await t.run();
    expect(t.vault.text('Yak/Personal/Home.md')).toBe('To [[Yak/Work/Acme/Brief|Brief]]');
    t.vault.put('Yak/Personal/Home.md', 'To [[Yak/Work/Acme/Brief|Brief]] again');
    await t.run();
    expect(noteTexts(t.personal.doc)['Home.md']).toBe('To [[Work:Acme/Brief]] again');
    // Nothing differs now, so the next pass changes neither side.
    const before = t.vault.text('Yak/Personal/Home.md');
    await t.run();
    expect(t.vault.text('Yak/Personal/Home.md')).toBe(before);
  });

  it('moves a renamed note with a vault rename and trashes a deleted one', async () => {
    const t = setup();
    addNote(t.personal.doc, 'A.md', 'alpha');
    addNote(t.personal.doc, 'B.md', 'beta');
    await t.run();
    await t.vault.rename('Yak/Personal/A.md', 'Yak/Personal/Sub/A2.md');
    await t.vault.remove('Yak/Personal/B.md');
    await t.run();
    expect(Object.keys(noteTexts(t.personal.doc))).toEqual(['Sub/A2.md']);
  });
});

describe('links written before a space was kept', () => {
  it('are rewritten once the space is kept, without a conflict', async () => {
    const vault = new MemoryVault();
    const personal: MirrorSpace = { id: 'p', folder: 'Personal', doc: new Y.Doc() };
    const work: MirrorSpace = { id: 'w', folder: 'Work', doc: new Y.Doc() };
    addNote(personal.doc, 'Home.md', 'To [[Work:Brief]]');
    addNote(work.doc, 'Brief.md', 'brief');
    const kept: MirrorSpace[] = [personal];
    const names = { p: 'Personal', w: 'Work' } as const;
    const linkSpaces = (): LinkSpace[] => kept.map((s) => ({ id: s.id, name: names[s.id as 'p' | 'w'], folder: s.folder, paths: Object.keys(noteTexts(s.doc)) }));
    const fs = new VaultFs(vault, 'Yak', linkSpaces);
    const state = emptyState();
    await syncMirror(fs, kept, state);
    expect(vault.text('Yak/Personal/Home.md')).toBe('To [[Work:Brief]]');
    kept.push(work);
    expect(await relinkFiles(vault, 'Yak', linkSpaces(), state)).toBe(1);
    expect(vault.text('Yak/Personal/Home.md')).toBe('To [[Yak/Work/Brief|Brief]]');
    const report = await syncMirror(fs, kept, state);
    expect(report.conflicts).toEqual([]);
    expect(noteTexts(personal.doc)['Home.md']).toBe('To [[Work:Brief]]');
  });
});

describe('files in the vault', () => {
  it('files pasted next to a note are copied into attachments/, and deletes go both ways', async () => {
    const vault = new MemoryVault();
    const space: MirrorSpace = { id: 'p', folder: 'Personal', doc: new Y.Doc(), blobs: new MemoryBlobStore() };
    const fs = new VaultFs(vault, 'Yak', () => []);
    const state = emptyState();
    vault.putBytes('Yak/Personal/Notes/Pasted image 1.png', new Uint8Array([1, 2, 3]));
    vault.putBytes('Yak/Personal/attachments/doc.pdf', new Uint8Array([4]));
    const r = await syncMirror(fs, [space], state);
    expect(r.errors).toEqual([]);
    expect(listAttachments(space.doc).map((a) => a.name).sort()).toEqual(['Pasted image 1.png', 'doc.pdf']);
    expect(vault.bytes('Yak/Personal/attachments/Pasted image 1.png')).toEqual(new Uint8Array([1, 2, 3]));
    // Deleted in Obsidian: gone from the index, not copied back from the stray.
    await vault.remove('Yak/Personal/attachments/doc.pdf');
    await syncMirror(fs, [space], state);
    expect(listAttachments(space.doc).map((a) => a.name)).toEqual(['Pasted image 1.png']);
  });
});
