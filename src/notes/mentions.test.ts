import { describe, expect, it } from 'vitest';
import { extractLinks, makeResolver } from './links';
import { unlinkedMentions, type MentionSource } from './mentions';

const note = (id: string, path: string, text: string): MentionSource => ({ id, path, text, links: extractLinks(text) });

describe('unlinkedMentions', () => {
  const acme = note('a', 'Clients/Acme.md', 'About Acme');
  const find = (others: MentionSource[]) => unlinkedMentions(acme, [acme, ...others], makeResolver([acme, ...others]));

  it('finds whole-word mentions in any case and counts them', () => {
    expect(find([note('b', 'Plan.md', 'call acme today. ACME again, but not Acmeville')])).toEqual([{ id: 'b', path: 'Plan.md', count: 2 }]);
  });
  it('ignores notes that already link, and mentions inside links or code', () => {
    expect(find([note('b', 'Linked.md', 'See [[Acme]] and Acme'), note('c', 'Alias.md', '[[Other|Acme]] `Acme`\n```\nAcme\n```')])).toEqual([]);
  });
  it('ignores very short titles', () => {
    const short = note('s', 'To.md', '');
    expect(unlinkedMentions(short, [short, note('b', 'B.md', 'to and fro')], makeResolver([short]))).toEqual([]);
  });
});
