import { describe, expect, it } from 'vitest';
import { outline } from './outline';

describe('outline', () => {
  it('lists headings with level and offset', () => {
    const text = '# One\ntext\n## Two ##\n###### Six\n####### seven\n';
    expect(outline(text)).toEqual([
      { level: 1, text: 'One', from: 0 },
      { level: 2, text: 'Two', from: 11 },
      { level: 6, text: 'Six', from: 21 },
    ]);
  });
  it('skips front matter and code', () => {
    const text = '---\ntitle: x\n# not a heading\n---\n# Real\n```\n# in code\n```\n#tag\n';
    expect(outline(text).map((h) => h.text)).toEqual(['Real']);
  });
  it('keeps inline code in the heading text', () => {
    expect(outline('# Use `foo`\n').map((h) => h.text)).toEqual(['Use `foo`']);
  });
});
