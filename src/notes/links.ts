import type { FrontMatterValue } from './frontmatter';
import { folderOf, splitPath, type PathItem } from './paths';

/** A `[[target#heading|alias]]` link (or `![[…]]` embed) in a note's text. */
export interface WikiLink {
  /** Note name or path as written, without heading or alias. Empty for `[[#Heading]]`. */
  target: string;
  heading: string | null;
  alias: string | null;
  embed: boolean;
  /** Offsets of the whole link in the text, `[[` to `]]`. */
  from: number;
  to: number;
}

/** Replace code (fenced blocks and inline spans) with spaces, keeping offsets, so links and tags in code are ignored. */
export function maskCode(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let i = from; i < to; i++) if (out[i] !== '\n') out[i] = ' ';
  };
  // Fenced blocks.
  const fence = /^( {0,3})(`{3,}|~{3,})[^\n]*$/gm;
  let open: { char: string; len: number; start: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    const marker = m[2]!;
    if (!open) open = { char: marker[0]!, len: marker.length, start: m.index };
    else if (marker[0] === open.char && marker.length >= open.len && m[0].trim() === marker) {
      blank(open.start, m.index + m[0].length);
      open = null;
    }
  }
  if (open) blank(open.start, text.length);
  // Inline code spans: a run of backticks closed by a run of the same length.
  const masked = out.join('');
  const inline = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/g;
  while ((m = inline.exec(masked))) blank(m.index, m.index + m[0].length);
  return out.join('');
}

const LINK = /(!?)\[\[([^[\]\n]+?)\]\]/g;

export function extractLinks(text: string): WikiLink[] {
  const src = maskCode(text);
  const out: WikiLink[] = [];
  let m: RegExpExecArray | null;
  LINK.lastIndex = 0;
  while ((m = LINK.exec(src))) {
    const inner = m[2]!;
    const pipe = inner.indexOf('|');
    const ref = pipe === -1 ? inner : inner.slice(0, pipe);
    const alias = pipe === -1 ? null : inner.slice(pipe + 1).trim() || null;
    const hash = ref.indexOf('#');
    const target = (hash === -1 ? ref : ref.slice(0, hash)).trim();
    const heading = hash === -1 ? null : ref.slice(hash + 1).trim() || null;
    out.push({ target, heading, alias, embed: m[1] === '!', from: m.index, to: m.index + m[0].length });
  }
  return out;
}

/** The link at a text offset (inclusive of the brackets), if any. */
export function linkAt(text: string, offset: number): WikiLink | null {
  return extractLinks(text).find((l) => offset >= l.from && offset <= l.to) ?? null;
}

const TAG = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;

/** Inline `#tags` in Markdown text (code excluded); a tag needs at least one non-digit. */
export function extractInlineTags(text: string): string[] {
  const src = maskCode(text);
  const out: string[] = [];
  let m: RegExpExecArray | null;
  TAG.lastIndex = 0;
  while ((m = TAG.exec(src))) {
    const tag = m[2]!.replace(/\/+$/, '');
    if (tag && !/^\d+$/.test(tag)) out.push(tag);
  }
  return out;
}

/** Tags from the front matter `tags` property: a list, or a string separated by commas or spaces. */
export function frontMatterTags(value: FrontMatterValue): string[] {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? value.split(/[,\s]+/) : [];
  return raw
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v).trim().replace(/^#/, ''))
    .filter((v) => v.length > 0);
}

/** Unique tags, compared case-insensitively, first spelling kept. */
export function uniqueTags(tags: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const t of tags) if (!seen.has(t.toLowerCase())) seen.set(t.toLowerCase(), t);
  return [...seen.values()];
}

function stripMd(path: string): string {
  return path.replace(/\.md$/i, '');
}

export type Resolver = (target: string, fromPath?: string) => PathItem | null;

/**
 * A link resolver over a set of notes, matching the way Obsidian resolves links: a full path wins,
 * then a path ending in the target (`Sub/Note` matches `Projects/Sub/Note.md`), preferring the
 * linking note's folder, then the shortest path.
 */
export function makeResolver(notes: readonly PathItem[]): Resolver {
  const byName = new Map<string, PathItem[]>();
  for (const n of notes) {
    const name = (splitPath(stripMd(n.path)).pop() ?? '').toLowerCase();
    byName.set(name, [...(byName.get(name) ?? []), n]);
  }
  return (target, fromPath = '') => {
    const t = stripMd(splitPath(target.replace(/\\/g, '/')).join('/')).toLowerCase();
    if (!t) return null;
    const name = t.split('/').pop() ?? t;
    const candidates: PathItem[] = [];
    for (const n of byName.get(name) ?? []) {
      const p = stripMd(n.path).toLowerCase();
      if (p === t || p.endsWith('/' + t)) candidates.push(n);
    }
    if (candidates.length === 0) return null;
    const folder = folderOf(fromPath).toLowerCase();
    const rank = (n: PathItem): number => (stripMd(n.path).toLowerCase() === t ? 0 : folderOf(n.path).toLowerCase() === folder ? 1 : 2);
    candidates.sort((a, b) => rank(a) - rank(b) || a.path.length - b.path.length || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) || (a.id < b.id ? -1 : 1));
    return candidates[0]!;
  };
}

export function resolveLink(target: string, notes: readonly PathItem[], fromPath = ''): PathItem | null {
  return makeResolver(notes)(target, fromPath);
}

export interface LinkSource extends PathItem {
  links: readonly WikiLink[];
}

/** Notes that link to `targetId`, each with the number of links. */
export function backlinks(targetId: string, notes: readonly LinkSource[], resolve: Resolver = makeResolver(notes)): { id: string; path: string; count: number }[] {
  const out: { id: string; path: string; count: number }[] = [];
  for (const n of notes) {
    if (n.id === targetId) continue;
    let count = 0;
    for (const l of n.links) if (resolve(l.target, n.path)?.id === targetId) count++;
    if (count > 0) out.push({ id: n.id, path: n.path, count });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/** Path for a new note created from an unresolved link: the target as a path, at the vault root. */
export function pathForLinkTarget(target: string): string {
  const segs = splitPath(target.replace(/\\/g, '/'));
  if (segs.length === 0) return '';
  return `${stripMd(segs.join('/'))}.md`;
}
