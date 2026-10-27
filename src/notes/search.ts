/**
 * Full-text search and the quick switcher's fuzzy match. Plain scans: fine for a few thousand notes.
 */

export interface Searchable {
  id: string;
  path: string;
  title: string;
  text: string;
  tags: readonly string[];
  /** Other names the note answers to (front matter `aliases`). */
  aliases?: readonly string[];
}

export interface SearchHit {
  id: string;
  path: string;
  title: string;
  /** Text around the first match. */
  snippet: string;
  score: number;
}

export { queryTerms } from '../core/search';
import { queryTerms } from '../core/search';

function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

/** Notes containing every term (in the path or text) and every `#tag`. Notes whose name (title or alias) holds every term rank above the rest. */
export function searchNotes(notes: readonly Searchable[], query: string, limit = 50): SearchHit[] {
  const { words, tags } = queryTerms(query);
  if (words.length === 0 && tags.length === 0) return [];
  const hits: SearchHit[] = [];
  for (const n of notes) {
    const noteTags = n.tags.map((t) => t.toLowerCase());
    // `#work` matches the tag `work` and its children such as `work/acme`.
    if (!tags.every((t) => noteTags.some((nt) => nt === t || nt.startsWith(t + '/')))) continue;
    const lowerText = n.text.toLowerCase();
    const lowerPath = n.path.toLowerCase();
    let score = 0;
    let first = -1;
    let firstLen = 0;
    let all = true;
    const names = [n.title, ...(n.aliases ?? [])].map((x) => x.toLowerCase());
    if (words.length > 0 && names.some((nm) => words.every((w) => nm.includes(w)))) score += 100;
    for (const w of words) {
      const inPath = lowerPath.includes(w) || names.some((nm) => nm.includes(w));
      const at = lowerText.indexOf(w);
      if (!inPath && at === -1) {
        all = false;
        break;
      }
      if (n.title.toLowerCase().includes(w)) score += 10;
      else if (inPath) score += 5;
      if (at !== -1) {
        score += 1;
        if (first === -1 || at < first) {
          first = at;
          firstLen = w.length;
        }
      }
    }
    if (!all) continue;
    hits.push({ id: n.id, path: n.path, title: n.title, snippet: first === -1 ? '' : snippetAt(n.text, first, firstLen), score });
  }
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

export interface SpaceHit extends SearchHit {
  spaceId: string;
}

/** `searchNotes` over several spaces: one ranked list, each hit carrying the space it is in. */
export function searchSpaces(spaces: readonly { id: string; notes: readonly Searchable[] }[], query: string, limit = 50): SpaceHit[] {
  const hits = spaces.flatMap((sp) => searchNotes(sp.notes, query, limit).map((h) => ({ ...h, spaceId: sp.id })));
  hits.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

/**
 * Fuzzy score of `query` against `target` (characters in order), higher is better, or -1 when
 * not all characters match. Consecutive matches and matches at word starts score more.
 */
export function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  if (!q) return 0;
  const t = target.toLowerCase();
  let score = 0;
  let ti = 0;
  let prev = -2;
  for (const ch of q) {
    const at = t.indexOf(ch, ti);
    if (at === -1) return -1;
    score += 1;
    if (at === prev + 1) score += 3;
    if (at === 0 || /[\s/_\-.]/.test(t[at - 1] ?? '')) score += 2;
    prev = at;
    ti = at + 1;
  }
  // Prefer shorter targets and exact substrings.
  if (t.includes(q)) score += 5;
  return score - t.length * 0.01;
}

/** Quick switcher results: by title first, then by path. */
export function switcherMatches<T extends { path: string; title: string }>(items: readonly T[], query: string, limit = 20): T[] {
  if (!query.trim()) return [...items].sort((a, b) => a.path.localeCompare(b.path)).slice(0, limit);
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const byTitle = fuzzyScore(query, item.title);
    const byPath = fuzzyScore(query, item.path);
    if (byTitle < 0 && byPath < 0) continue;
    scored.push({ item, score: Math.max(byTitle >= 0 ? byTitle + 1 : -1, byPath) });
  }
  scored.sort((a, b) => b.score - a.score || a.item.path.localeCompare(b.item.path));
  return scored.slice(0, limit).map((s) => s.item);
}
