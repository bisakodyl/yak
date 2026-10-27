import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyLinkEdits, type LinkNote, moveWithLinks, planLinkUpdates, readLinkMode, writeLinkMode } from './link-update';
import { buildIndex, createNote, noteText } from './note-store';

function vault(files: Record<string, string>) {
  const doc = new Y.Doc();
  const ids: Record<string, string> = {};
  for (const [path, text] of Object.entries(files)) ids[path] = createNote(doc, path, text);
  const notes = (): LinkNote[] => buildIndex(doc).notes;
  const text = (path: string): string => noteText(doc, ids[path]!)?.toString() ?? '';
  return { doc, ids, notes, text };
}

describe('planLinkUpdates', () => {
  it('rewrites a link when a note is renamed, keeping heading, alias and embed', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'See [[Acme]], [[Acme#Plan|the plan]] and ![[Acme]]. Not [[Beta]].' });
    moveWithLinks(v.doc, v.notes(), [{ id: v.ids['Acme.md']!, path: 'Acme Corp.md' }], 'auto');
    expect(v.text('Index.md')).toBe('See [[Acme Corp]], [[Acme Corp#Plan|the plan]] and ![[Acme Corp]]. Not [[Beta]].');
  });

  it('needs no edit when a note moves folders and its name still resolves', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'See [[Acme]]' });
    expect(planLinkUpdates(v.notes(), [{ id: v.ids['Acme.md']!, path: 'Clients/Acme.md' }])).toEqual([]);
  });

  it('rewrites a link written as a path when the folder changes', () => {
    const v = vault({ 'Projects/Acme.md': 'x', 'Index.md': 'See [[Projects/Acme]]' });
    moveWithLinks(v.doc, v.notes(), [{ id: v.ids['Projects/Acme.md']!, path: 'Archive/Acme.md' }], 'auto');
    expect(v.text('Index.md')).toBe('See [[Archive/Acme]]');
  });

  it('uses a longer form when the short name would be ambiguous', () => {
    const v = vault({ 'A/Notes.md': 'x', 'B/Notes.md': 'y', 'Index.md': 'See [[A/Notes]]' });
    moveWithLinks(v.doc, v.notes(), [{ id: v.ids['A/Notes.md']!, path: 'C/Notes.md' }], 'auto');
    expect(v.text('Index.md')).toBe('See [[C/Notes]]');
    const w = vault({ 'Notes.md': 'x', 'Other/Notes 2.md': 'y', 'Index.md': 'See [[Notes]]' });
    moveWithLinks(w.doc, w.notes(), [{ id: w.ids['Other/Notes 2.md']!, path: 'Other/Notes.md' }], 'auto');
    // [[Notes]] resolves to the root note first, so it keeps working untouched.
    expect(w.text('Index.md')).toBe('See [[Notes]]');
  });

  it('follows a folder rename for every note in it', () => {
    const v = vault({ 'Old/A.md': 'a', 'Old/B.md': 'See [[A]] and [[Old/A]]', 'Index.md': '[[Old/B]]' });
    moveWithLinks(
      v.doc,
      v.notes(),
      [
        { id: v.ids['Old/A.md']!, path: 'New/A.md' },
        { id: v.ids['Old/B.md']!, path: 'New/B.md' },
      ],
      'auto',
    );
    expect(v.text('Old/B.md')).toBe('See [[A]] and [[New/A]]');
    expect(v.text('Index.md')).toBe('[[New/B]]');
  });

  it('leaves links in code alone and unresolved links alone', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'Code: `[[Acme]]` and [[Nowhere]]' });
    moveWithLinks(v.doc, v.notes(), [{ id: v.ids['Acme.md']!, path: 'Zed.md' }], 'auto');
    expect(v.text('Index.md')).toBe('Code: `[[Acme]]` and [[Nowhere]]');
  });
});

describe('modes', () => {
  it('ask moves the note and returns the plan; applying it later fixes the links, and a stale edit is skipped', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'See [[Acme]] twice [[Acme]]' });
    const edits = moveWithLinks(v.doc, v.notes(), [{ id: v.ids['Acme.md']!, path: 'Zed.md' }], 'ask');
    expect(edits).toHaveLength(2);
    expect(v.text('Index.md')).toBe('See [[Acme]] twice [[Acme]]');
    const t = noteText(v.doc, v.ids['Index.md']!)!;
    // The first link was edited meanwhile (same length), so only the second is still where the plan says.
    t.delete(6, 4);
    t.insert(6, 'Bcme');
    expect(applyLinkEdits(v.doc, edits)).toEqual({ links: 1, notes: 1 });
    expect(v.text('Index.md')).toBe('See [[Bcme]] twice [[Zed]]');
  });

  it('off moves the note and changes nothing else', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'See [[Acme]]' });
    expect(moveWithLinks(v.doc, v.notes(), [{ id: v.ids['Acme.md']!, path: 'Zed.md' }], 'off')).toEqual([]);
    expect(v.text('Index.md')).toBe('See [[Acme]]');
  });

  it('is stored in the account settings, automatic by default', () => {
    const account = new Y.Doc();
    expect(readLinkMode(account)).toBe('auto');
    writeLinkMode(account, 'ask');
    expect(readLinkMode(account)).toBe('ask');
  });

  it('undo: moving back restores the original links', () => {
    const v = vault({ 'Acme.md': 'x', 'Index.md': 'See [[Acme]] [[Acme#H|h]]' });
    const id = v.ids['Acme.md']!;
    moveWithLinks(v.doc, v.notes(), [{ id, path: 'Zed.md' }], 'auto');
    moveWithLinks(v.doc, v.notes(), [{ id, path: 'Acme.md' }], 'auto');
    expect(v.text('Index.md')).toBe('See [[Acme]] [[Acme#H|h]]');
  });
});
