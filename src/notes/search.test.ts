import { describe, expect, it } from 'vitest';
import { fuzzyScore, queryTerms, searchNotes, searchSpaces, switcherMatches } from './search';

const notes = [
  { id: '1', path: 'Projects/Acme.md', title: 'Acme', text: 'Kickoff meeting with the Acme team about invoices.', tags: ['work/acme'] },
  { id: '2', path: 'Daily/2026-10-15.md', title: '2026-10-15', text: 'Called Acme. Wrote the invoice draft.', tags: ['daily'] },
  { id: '3', path: 'Ideas.md', title: 'Ideas', text: 'A garden shed.', tags: [] },
];

describe('full-text search', () => {
  it('parses terms, phrases and tags', () => {
    expect(queryTerms('Acme "the invoice" #Work')).toEqual({ words: ['acme', 'the invoice'], tags: ['work'] });
  });

  it('finds notes containing every term, title matches first, with a snippet', () => {
    const hits = searchNotes(notes, 'acme invoice');
    expect(hits.map((h) => h.id)).toEqual(['1', '2']);
    expect(hits[1]!.snippet).toContain('Acme');
    expect(searchNotes(notes, '"the invoice"').map((h) => h.id)).toEqual(['2']);
    expect(searchNotes(notes, 'shed').map((h) => h.id)).toEqual(['3']);
    expect(searchNotes(notes, 'nothing-here')).toEqual([]);
    expect(searchNotes(notes, '   ')).toEqual([]);
  });

  it('filters by tag, including nested tags', () => {
    expect(searchNotes(notes, '#work').map((h) => h.id)).toEqual(['1']);
    expect(searchNotes(notes, '#work/acme kickoff').map((h) => h.id)).toEqual(['1']);
    expect(searchNotes(notes, '#daily acme').map((h) => h.id)).toEqual(['2']);
  });

  it('ranks notes whose name or alias matches above full-text hits', () => {
    const more = [
      { id: 'a', path: 'Log.md', title: 'Log', text: 'Spoke to Ideas Inc. about the shed. Ideas Ideas Ideas.', tags: [] },
      { id: 'b', path: 'Notes/Garden.md', title: 'Garden', text: 'Plans.', tags: [], aliases: ['Ideas for spring'] },
      notes[2]!,
    ];
    expect(searchNotes(more, 'ideas').map((h) => h.id)).toEqual(['3', 'b', 'a']);
  });

  it('matches paths too', () => {
    expect(searchNotes(notes, 'daily').map((h) => h.id)).toEqual(['2']);
  });
});

describe('quick switcher', () => {
  it('scores in-order characters and rejects others', () => {
    expect(fuzzyScore('acm', 'Acme')).toBeGreaterThan(fuzzyScore('acm', 'a cat moved'));
    expect(fuzzyScore('xyz', 'Acme')).toBe(-1);
  });

  it('ranks by title, lists everything for an empty query', () => {
    expect(switcherMatches(notes, 'ide').map((n) => n.id)).toEqual(['3']);
    expect(switcherMatches(notes, 'proj acme').map((n) => n.id)).toEqual(['1']);
    expect(switcherMatches(notes, '').map((n) => n.id)).toEqual(['2', '3', '1']);
    expect(switcherMatches(notes, 'qqq')).toEqual([]);
  });
});

describe('search across spaces', () => {
  it('ranks hits from every space together and names each hit\'s space', () => {
    const other = [{ id: '9', path: 'Acme.md', title: 'Acme', text: 'Acme in the other space.', tags: [] }];
    const hits = searchSpaces(
      [
        { id: 'a', notes },
        { id: 'b', notes: other },
      ],
      'acme',
    );
    expect(hits.map((h) => [h.spaceId, h.id])).toEqual([
      ['b', '9'],
      ['a', '1'],
      ['a', '2'],
    ]);
    expect(searchSpaces([{ id: 'a', notes }], 'acme', 1)).toHaveLength(1);
    expect(searchSpaces([{ id: 'a', notes }], '')).toEqual([]);
  });
});
