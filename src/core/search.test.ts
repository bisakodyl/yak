import { describe, expect, it } from 'vitest';
import { queryTerms, rankItems, type SearchItem } from './search';

const item = (kind: string, id: string, title: string, extra: Partial<SearchItem> = {}): SearchItem => ({ kind, spaceId: 's', id, title, ...extra });

describe('rankItems', () => {
  const items = [
    item('note', 'n', 'Budget plan', { text: 'quarterly numbers' }),
    item('task', 't', 'Send report', { text: 'about the budget' }),
    item('entry', 'e', 'call', { names: ['Budget review'], tags: ['Work/Acme'] }),
    item('tag', 'g', 'finance'),
  ];
  it('finds a word in every kind, titles first', () => {
    const r = rankItems(items, 'budget');
    expect(r.map((x) => x.item.id)).toEqual(['n', 'e', 't']);
  });
  it('takes words in any order and phrases whole', () => {
    expect(rankItems(items, 'plan budget').map((x) => x.item.id)).toEqual(['n']);
    expect(rankItems(items, '"about the budget"').map((x) => x.item.id)).toEqual(['t']);
    expect(rankItems(items, '"budget the"')).toEqual([]);
  });
  it('matches #tag and its children', () => {
    expect(rankItems(items, '#work').map((x) => x.item.id)).toEqual(['e']);
    expect(rankItems(items, '#work budget').map((x) => x.item.id)).toEqual(['e']);
  });
  it('marks the match in a snippet and can search a space name', () => {
    expect(rankItems(items, 'numbers')[0]!.snippet).toContain('numbers');
    expect(rankItems(items, 'finance').length).toBe(1);
    expect(rankItems([item('note', 'x', 'Idea')], 'acme', new Map([['s', 'Acme Corp']])).map((x) => x.item.id)).toEqual(['x']);
  });
  it('returns nothing for an empty query', () => {
    expect(rankItems(items, '  ')).toEqual([]);
    expect(queryTerms('#a "b c" d')).toEqual({ words: ['b c', 'd'], tags: ['a'] });
  });
});
