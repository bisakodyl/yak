import type { ComponentChildren } from 'preact';
import { type Block, type Inline, parseMarkdown } from './markdown';

function inline(nodes: Inline[]): ComponentChildren {
  return nodes.map((n, i) => {
    if (n.t === 'text') return n.text;
    if (n.t === 'code') return <code key={i}>{n.text}</code>;
    if (n.t === 'strong') return <strong key={i}>{inline(n.children)}</strong>;
    if (n.t === 'em') return <em key={i}>{inline(n.children)}</em>;
    if (n.t !== 'link') return null;
    const external = n.href.startsWith('https://');
    return (
      <a key={i} href={n.href} {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}>
        {inline(n.children)}
      </a>
    );
  });
}

function block(b: Block, i: number): ComponentChildren {
  switch (b.t) {
    case 'heading': {
      // The section supplies the title (the file's h1), so the file's h2 is the page's h3.
      if (b.level === 1) return null;
      const Tag = (b.level === 2 ? 'h3' : 'h4') as 'h3' | 'h4';
      return <Tag key={i}>{inline(b.children)}</Tag>;
    }
    case 'p':
      return <p key={i}>{inline(b.children)}</p>;
    case 'quote':
      return <blockquote key={i}>{inline(b.children)}</blockquote>;
    case 'code':
      return <pre key={i} tabIndex={0}>{b.text}</pre>;
    case 'list': {
      const Tag = b.ordered ? 'ol' : 'ul';
      return <Tag key={i}>{b.items.map((it, j) => <li key={j}>{inline(it)}</li>)}</Tag>;
    }
    case 'table':
      return (
        <table key={i}>
          <thead>
            <tr>{b.head.map((c, j) => <th key={j} scope="col">{inline(c)}</th>)}</tr>
          </thead>
          <tbody>
            {b.rows.map((r, j) => <tr key={j}>{r.map((c, k) => <td key={k}>{inline(c)}</td>)}</tr>)}
          </tbody>
        </table>
      );
  }
}

/** Renders bundled Markdown as elements (no HTML is injected). */
export function Markdown({ source }: { source: string }) {
  return <div class="help-doc">{parseMarkdown(source).map(block)}</div>;
}
