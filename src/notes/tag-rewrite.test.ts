import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createNote, notesMap, rewriteNoteTags } from './note-store';
import { rewriteTag } from './tag-rewrite';

describe('rewriteTag', () => {
  it('renames in a front matter list, case-insensitively, keeping other lines', () => {
    const text = '---\ntitle: A\ntags:\n  - Work\n  - other\n---\nBody\n';
    expect(rewriteTag(text, 'work', 'job')).toBe('---\ntitle: A\ntags:\n  - job\n  - other\n---\nBody\n');
  });

  it('renames in a flow list and keeps a # prefix', () => {
    expect(rewriteTag('---\ntags: [work, "#x"]\n---\n', 'x', 'y')).toContain('#y');
    expect(rewriteTag('---\ntags: [work, other]\n---\n', 'work', 'job')).toContain('job');
  });

  it('renames in a string value, separated by commas or spaces', () => {
    expect(rewriteTag('---\ntags: a, b\n---\n', 'a', 'c')).toBe('---\ntags: c, b\n---\n');
    expect(rewriteTag('---\ntags: a b\n---\n', 'b', 'c')).toBe('---\ntags: a c\n---\n');
  });

  it('merges into a tag the note already has', () => {
    const out = rewriteTag('---\ntags:\n  - a\n  - b\n---\n', 'a', 'b');
    expect(out).toBe('---\ntags:\n  - b\n---\n');
  });

  it('removes the tags line with the last tag', () => {
    expect(rewriteTag('---\ntitle: A\ntags:\n  - a\n---\nx', 'a', null)).toBe('---\ntitle: A\n---\nx');
  });

  it('renames inline tags and skips code', () => {
    const text = 'Hello #work and #worker, `#work`\n\n```\n#work\n```\n(#Work) done';
    expect(rewriteTag(text, 'work', 'job')).toBe('Hello #job and #worker, `#work`\n\n```\n#work\n```\n(#job) done');
  });

  it('removes inline tags without leaving a gap', () => {
    expect(rewriteTag('a #x b', 'x', null)).toBe('a b');
    expect(rewriteTag('a #x\nb', 'x', null)).toBe('a\nb');
    expect(rewriteTag('#x a', 'x', null)).toBe('a');
  });

  it('leaves a text without the tag unchanged', () => {
    const text = '---\ntags: [a]\n---\n#b';
    expect(rewriteTag(text, 'zzz', 'y')).toBe(text);
  });
});

describe('rewriteNoteTags', () => {
  it('rewrites live notes only and counts them', () => {
    const doc = new Y.Doc();
    const a = createNote(doc, 'A.md', 'one #t');
    createNote(doc, 'B.md', 'two');
    const c = createNote(doc, 'C.md', 'three #t');
    notesMap(doc).get(c)?.set('deleted', true);
    expect(rewriteNoteTags(doc, 't', 'u')).toBe(1);
    expect((notesMap(doc).get(a)?.get('text') as Y.Text).toString()).toBe('one #u');
    expect((notesMap(doc).get(c)?.get('text') as Y.Text).toString()).toBe('three #t');
  });
});
