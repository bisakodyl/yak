/**
 * A small Markdown reader for the bundled user guide (`docs/user/*.md`): headings, paragraphs, flat
 * lists, tables, fenced code, quotes and the inline marks `code`, **bold**, *italic*, [link](url).
 * It returns data, never HTML, so the view builds elements and nothing is injected.
 */

export type Inline =
  | { t: 'text'; text: string }
  | { t: 'code'; text: string }
  | { t: 'strong' | 'em'; children: Inline[] }
  | { t: 'link'; href: string; children: Inline[] };

export type Block =
  | { t: 'heading'; level: 1 | 2 | 3; children: Inline[] }
  | { t: 'p'; children: Inline[] }
  | { t: 'list'; ordered: boolean; items: Inline[][] }
  | { t: 'quote'; children: Inline[] }
  | { t: 'code'; text: string }
  | { t: 'table'; head: Inline[][]; rows: Inline[][][] };

/** Only in-app and https links are kept; anything else (javascript:, data:) shows as plain text. */
export function safeHref(href: string): string | null {
  return /^(#\/|https:\/\/)/.test(href) ? href : null;
}

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = (): void => {
    if (text) out.push({ t: 'text', text });
    text = '';
  };
  let i = 0;
  while (i < src.length) {
    const rest = src.slice(i);
    let m: RegExpExecArray | null;
    if ((m = /^`([^`]+)`/.exec(rest))) {
      flush();
      out.push({ t: 'code', text: m[1] as string });
    } else if ((m = /^\*\*(.+?)\*\*/.exec(rest))) {
      flush();
      out.push({ t: 'strong', children: parseInline(m[1] as string) });
    } else if ((m = /^\*([^*\s][^*]*?)\*/.exec(rest))) {
      flush();
      out.push({ t: 'em', children: parseInline(m[1] as string) });
    } else if ((m = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest))) {
      const href = safeHref(m[2] as string);
      flush();
      if (href) out.push({ t: 'link', href, children: parseInline(m[1] as string) });
      else out.push({ t: 'text', text: m[1] as string });
    } else {
      text += src[i];
      i++;
      continue;
    }
    i += m[0].length;
  }
  flush();
  return out;
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).startsWith('```')) body.push(lines[i++] as string);
      i++;
      blocks.push({ t: 'code', text: body.join('\n') });
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ t: 'heading', level: (h[1] as string).length as 1 | 2 | 3, children: parseInline(h[2] as string) });
      i++;
      continue;
    }
    if (line.startsWith('|') && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1] ?? '')) {
      const head = cells(line).map(parseInline);
      const rows: Inline[][][] = [];
      i += 2;
      while (i < lines.length && (lines[i] as string).startsWith('|')) rows.push(cells(lines[i++] as string).map(parseInline));
      blocks.push({ t: 'table', head, rows });
      continue;
    }
    const li = /^(-|\d+\.)\s+/;
    if (li.test(line)) {
      const ordered = !line.startsWith('-');
      const items: string[] = [];
      while (i < lines.length && (lines[i] as string).trim()) {
        const cur = lines[i] as string;
        if (li.test(cur)) items.push(cur.replace(li, ''));
        else if (/^\s+\S/.test(cur) && items.length) items[items.length - 1] += ' ' + cur.trim();
        else break;
        i++;
      }
      blocks.push({ t: 'list', ordered, items: items.map(parseInline) });
      continue;
    }
    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && (lines[i] as string).startsWith('>')) body.push((lines[i++] as string).replace(/^>\s?/, ''));
      blocks.push({ t: 'quote', children: parseInline(body.join(' ')) });
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() && !/^(```|#{1,3}\s|>|\|)/.test(lines[i] as string) && !li.test(lines[i] as string)) para.push((lines[i++] as string).trim());
    blocks.push({ t: 'p', children: parseInline(para.join(' ')) });
  }
  return blocks;
}
