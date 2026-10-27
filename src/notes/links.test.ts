import { describe, expect, it } from 'vitest';
import { backlinks, extractInlineTags, extractLinks, frontMatterTags, linkAt, makeResolver, maskCode, pathForLinkTarget, resolveLink, uniqueTags } from './links';

describe('wikilinks', () => {
  it('extracts targets, headings, aliases and embeds with offsets', () => {
    const text = 'See [[Acme]] and [[Projects/Beta#Plan|the plan]], ![[diagram.png]] and [[#Local]].';
    const links = extractLinks(text);
    expect(links.map((l) => [l.target, l.heading, l.alias, l.embed])).toEqual([
      ['Acme', null, null, false],
      ['Projects/Beta', 'Plan', 'the plan', false],
      ['diagram.png', null, null, true],
      ['', 'Local', null, false],
    ]);
    expect(text.slice(links[0]!.from, links[0]!.to)).toBe('[[Acme]]');
    expect(linkAt(text, 6)?.target).toBe('Acme');
    expect(linkAt(text, 0)).toBeNull();
  });

  it('ignores links in code', () => {
    const text = 'a [[One]]\n```\n[[Two]]\n```\n`[[Three]]` and ``x [[Four]] x`` then [[Five]]\n~~~md\n[[Six]]';
    expect(extractLinks(text).map((l) => l.target)).toEqual(['One', 'Five']);
    expect(maskCode('x `y` z')).toBe('x     z');
  });

  it('resolves like Obsidian: full path, then by name, preferring the same folder, then the shortest path', () => {
    const notes = [
      { id: '1', path: 'Acme.md' },
      { id: '2', path: 'Projects/Acme.md' },
      { id: '3', path: 'Projects/Sub/Beta.md' },
      { id: '4', path: 'Archive/Old/Beta.md' },
      { id: '5', path: 'Archive/Beta.md' },
    ];
    expect(resolveLink('Acme', notes)?.id).toBe('1');
    expect(resolveLink('projects/acme', notes)?.id).toBe('2');
    expect(resolveLink('Projects/Acme.md', notes)?.id).toBe('2');
    expect(resolveLink('Beta', notes)?.id).toBe('5');
    expect(resolveLink('Beta', notes, 'Projects/Sub/Other.md')?.id).toBe('3');
    expect(resolveLink('Sub/Beta', notes)?.id).toBe('3');
    expect(resolveLink('Missing', notes)).toBeNull();
    expect(resolveLink('', notes)).toBeNull();
    expect(pathForLinkTarget('Ideas/New idea')).toBe('Ideas/New idea.md');
  });

  it('lists backlinks with counts', () => {
    const notes = [
      { id: 'a', path: 'A.md', links: extractLinks('[[B]] and [[B|again]]') },
      { id: 'b', path: 'B.md', links: extractLinks('[[B]] self') },
      { id: 'c', path: 'Sub/C.md', links: extractLinks('[[b#h]] [[A]]') },
      { id: 'd', path: 'D.md', links: extractLinks('nothing') },
    ];
    expect(backlinks('b', notes)).toEqual([
      { id: 'a', path: 'A.md', count: 2 },
      { id: 'c', path: 'Sub/C.md', count: 1 },
    ]);
    const resolve = makeResolver(notes);
    expect(backlinks('a', notes, resolve).map((b) => b.id)).toEqual(['c']);
  });
});

describe('tags', () => {
  it('extracts inline tags, not headings, numbers, links or code', () => {
    const text = '# Heading\n#work and #project/acme, (#nested-tag) #2026 #y2026 [[Note#Heading]] `#code` url.com/#frag #tag/';
    expect(extractInlineTags(text)).toEqual(['work', 'project/acme', 'nested-tag', 'y2026', 'tag']);
    expect(extractInlineTags('#über #日本')).toEqual(['über', '日本']);
  });

  it('reads front matter tags as a list or a string', () => {
    expect(frontMatterTags(['task', '#work', 3])).toEqual(['task', 'work', '3']);
    expect(frontMatterTags('task, work home')).toEqual(['task', 'work', 'home']);
    expect(frontMatterTags(undefined)).toEqual([]);
    expect(uniqueTags(['Work', 'work', 'home'])).toEqual(['Work', 'home']);
  });
});
