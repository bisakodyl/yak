import { describe, expect, it } from 'vitest';
import { parseInline, parseMarkdown, safeHref } from './markdown';

describe('markdown', () => {
  it('reads headings, paragraphs and lists', () => {
    const b = parseMarkdown('# Title\n\nOne line\nsecond line.\n\n- a\n- b\n  more\n\n1. x\n2. y');
    expect(b[0]).toMatchObject({ t: 'heading', level: 1 });
    expect(b[1]).toMatchObject({ t: 'p', children: [{ t: 'text', text: 'One line second line.' }] });
    expect(b[2]).toMatchObject({ t: 'list', ordered: false });
    expect((b[2] as { items: unknown[] }).items).toHaveLength(2);
    expect(b[3]).toMatchObject({ t: 'list', ordered: true });
  });
  it('reads tables and code', () => {
    const b = parseMarkdown('| A | B |\n| --- | --- |\n| 1 | `x` |\n\n```\nraw *text*\n```');
    expect(b[0]).toMatchObject({ t: 'table' });
    expect((b[0] as { rows: unknown[] }).rows).toHaveLength(1);
    expect(b[1]).toEqual({ t: 'code', text: 'raw *text*' });
  });
  it('reads inline marks', () => {
    expect(parseInline('a **b** *c* `d` [e](#/timer)')).toEqual([
      { t: 'text', text: 'a ' },
      { t: 'strong', children: [{ t: 'text', text: 'b' }] },
      { t: 'text', text: ' ' },
      { t: 'em', children: [{ t: 'text', text: 'c' }] },
      { t: 'text', text: ' ' },
      { t: 'code', text: 'd' },
      { t: 'text', text: ' ' },
      { t: 'link', href: '#/timer', children: [{ t: 'text', text: 'e' }] },
    ]);
  });
  it('drops unsafe links', () => {
    expect(safeHref('javascript:alert(1)')).toBeNull();
    expect(safeHref('https://example.com')).toBe('https://example.com');
    expect(parseInline('[x](javascript:evil)')).toEqual([{ t: 'text', text: 'x' }]);
  });
});
