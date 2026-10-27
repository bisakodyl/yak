import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyEdit, findFrontMatter, formatValue, minimalEdit, parseInput, parseNote, propertyEdit, serializeFrontMatter, setProperties } from './frontmatter';
import { applyTextEdit, setNoteProperty } from './note-store';

const NOTE = `---
title: Write report # keep this comment
tags:
  - task
  - work
# a comment between keys
status: open
due: 2026-10-20
---
# Body

Some text.
`;

describe('front matter parsing', () => {
  it('finds the block and parses top-level properties', () => {
    const p = parseNote(NOTE);
    expect(p.error).toBeNull();
    expect(p.properties).toEqual({ title: 'Write report', tags: ['task', 'work'], status: 'open', due: '2026-10-20' });
    expect(p.body).toBe('# Body\n\nSome text.\n');
  });

  it('treats a text without an opening line, or without a closing line, as having none', () => {
    expect(findFrontMatter('# Title\n---\na: 1\n---\n')).toBeNull();
    expect(findFrontMatter('---\na: 1\nno end')).toBeNull();
    expect(parseNote('plain').body).toBe('plain');
  });

  it('accepts an empty block, CRLF line ends and a closing line at the end of the file', () => {
    expect(parseNote('---\n---\nbody').properties).toEqual({});
    expect(parseNote('---\r\na: 1\r\n---\r\nbody').properties).toEqual({ a: 1 });
    expect(parseNote('---\na: x\n---').body).toBe('');
  });

  it('reports invalid YAML instead of throwing', () => {
    const p = parseNote('---\na: [unclosed\n---\nbody');
    expect(p.error).toBeTruthy();
    expect(p.properties).toEqual({});
    expect(propertyEdit('---\na: [unclosed\n---\nbody', 'b', 1)).toBeNull();
  });

  it('keeps dates as strings', () => {
    expect(parseNote('---\ndue: 2026-10-20\nat: 2026-10-20T10:00:00Z\n---\n').properties).toEqual({ due: '2026-10-20', at: '2026-10-20T10:00:00Z' });
  });
});

describe('serialize and round trip', () => {
  it('serializes properties so that parsing gives them back', () => {
    const props = { title: 'A: tricky "title"', tags: ['task', 'x y'], n: 3, done: false, empty: [], nested: { a: 1 } };
    const text = serializeFrontMatter(props) + 'body\n';
    expect(parseNote(text).properties).toEqual(props);
    expect(parseNote(text).body).toBe('body\n');
  });

  it('round-trips arbitrary property values through setProperties', () => {
    const values: unknown[] = ['plain', '', 'with: colon', '#hash', '- dash', 'multi\nline', 0, -1.5, true, null, ['a', 'b, c'], [], { k: 'v' }, '2026-01-01', 'yes', '123'];
    for (const v of values) {
      const text = setProperties('---\nother: 1\n---\nbody', { key: v });
      expect(text).not.toBeNull();
      const p = parseNote(text!);
      expect(p.properties.key).toEqual(v);
      expect(p.properties.other).toBe(1);
      expect(p.body).toBe('body');
    }
  });
});

describe('minimal property edits', () => {
  it('changes only the characters of the changed value', () => {
    const edit = propertyEdit(NOTE, 'status', 'done')!;
    expect(edit.insert).toBe('done');
    expect(edit.remove).toBe('open'.length);
    expect(NOTE.slice(edit.index, edit.index + edit.remove)).toBe('open');
    const out = applyEdit(NOTE, edit);
    expect(out).toContain('# keep this comment');
    expect(out).toContain('# a comment between keys');
    expect(parseNote(out).properties.status).toBe('done');
  });

  it('keeps every other line byte for byte', () => {
    const out = setProperties(NOTE, { status: 'in-progress', tags: ['task', 'work', 'urgent'] })!;
    const before = NOTE.split('\n');
    const after = out.split('\n');
    expect(after.filter((l) => !before.includes(l))).toEqual(['  - urgent', 'status: in-progress']);
  });

  it('adds a new property at the end of the block and removes one by its lines', () => {
    const added = applyEdit(NOTE, propertyEdit(NOTE, 'priority', 'high')!);
    expect(added).toContain('due: 2026-10-20\npriority: high\n---\n');
    const removed = applyEdit(added, propertyEdit(added, 'tags', undefined)!);
    expect(parseNote(removed).properties).toEqual({ title: 'Write report', status: 'open', due: '2026-10-20', priority: 'high' });
    expect(removed).toContain('# a comment between keys');
  });

  it('removes a multi-line block value completely', () => {
    const text = '---\na: |\n  one\n  two\n\nb: 2\n---\nbody';
    const out = applyEdit(text, propertyEdit(text, 'a', undefined)!);
    expect(parseNote(out).properties).toEqual({ b: 2 });
  });

  it('creates a block when the note has none, and leaves the body alone', () => {
    const out = setProperties('Just a body\n', { status: 'open' })!;
    expect(out).toBe('---\nstatus: open\n---\nJust a body\n');
  });

  it('is a no-op when the value does not change or a missing key is removed', () => {
    const same = propertyEdit(NOTE, 'status', 'open')!;
    expect(same.remove).toBe(0);
    expect(same.insert).toBe('');
    expect(propertyEdit(NOTE, 'missing', undefined)).toEqual({ index: 0, remove: 0, insert: '' });
  });

  it('handles a last property without a trailing newline before the closing line', () => {
    const text = '---\na: 1\n---\nbody';
    expect(setProperties(text, { a: 2 })).toBe('---\na: 2\n---\nbody');
  });

  it('never splits surrogate pairs', () => {
    const e = minimalEdit('a😀b', 'a😃b');
    expect(applyEdit('a😀b', e)).toBe('a😃b');
    expect(e.remove).toBe(2);
  });
});

describe('concurrent front matter and body edits', () => {
  it('keeps a body edit on one device and a property change on another', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    a.getText('t').insert(0, NOTE);
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));

    // Device A types in the body while device B changes the status, both offline.
    const ta = a.getText('t');
    ta.insert(ta.length, 'Typed on A.\n');
    const tb = b.getText('t');
    const edit = propertyEdit(tb.toString(), 'status', 'done')!;
    b.transact(() => applyTextEdit(tb, edit));
    const edit2 = propertyEdit(tb.toString(), 'tags', ['task', 'work', 'b'])!;
    b.transact(() => applyTextEdit(tb, edit2));

    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const merged = a.getText('t').toString();
    expect(merged).toBe(b.getText('t').toString());
    const p = parseNote(merged);
    expect(p.properties.status).toBe('done');
    expect(p.properties.tags).toEqual(['task', 'work', 'b']);
    expect(p.body).toBe('# Body\n\nSome text.\nTyped on A.\n');
  });

  it('keeps two different properties changed on two devices', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const notes = a.getMap<Y.Map<unknown>>('notes');
    a.transact(() => {
      const rec = new Y.Map<unknown>();
      rec.set('path', 'Tasks/A.md');
      rec.set('text', new Y.Text(NOTE));
      notes.set('id1', rec);
    });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect(setNoteProperty(a, 'id1', 'status', 'done')).toBe(true);
    expect(setNoteProperty(b, 'id1', 'priority', 'high')).toBe(true);
    // A body edit at the very start of the body on A, right after the closing line.
    const ta = notes.get('id1')!.get('text') as Y.Text;
    const bodyStart = findFrontMatter(ta.toString())!.bodyStart;
    ta.insert(bodyStart, 'First line from A\n');
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
    const text = (a.getMap<Y.Map<unknown>>('notes').get('id1')!.get('text') as Y.Text).toString();
    expect(text).toBe((b.getMap<Y.Map<unknown>>('notes').get('id1')!.get('text') as Y.Text).toString());
    const p = parseNote(text);
    expect(p.properties.status).toBe('done');
    expect(p.properties.priority).toBe('high');
    expect(p.body.startsWith('First line from A\n# Body')).toBe(true);
  });
});

describe('inputs', () => {
  it('formats and parses values keeping their type', () => {
    expect(formatValue(['a', 'b'])).toBe('a, b');
    expect(formatValue(null)).toBe('');
    expect(parseInput('a, b ,', ['x'])).toEqual(['a', 'b']);
    expect(parseInput('', ['x'])).toEqual([]);
    expect(parseInput('', 'x')).toBeUndefined();
    expect(parseInput('42', 3)).toBe(42);
    expect(parseInput('abc', 3)).toBe('abc');
    expect(parseInput('TRUE', false)).toBe(true);
    expect(parseInput('a, b', undefined)).toEqual(['a', 'b']);
    expect(parseInput('2026-10-20', '2026-10-01')).toBe('2026-10-20');
  });
});
