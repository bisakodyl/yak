/**
 * Ranking for the universal search (`Ctrl+Shift+F`). Items come from the modules (see
 * `src/app/search-sources.ts`); this file only scores them, so it holds no module's data shapes.
 */

/** Split a query into lower-case terms; `#tag` terms match tags, `"quoted phrases"` stay whole. */
export function queryTerms(query: string): { words: string[]; tags: string[] } {
  const words: string[] = [];
  const tags: string[] = [];
  const re = /"([^"]+)"|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const term = (m[1] ?? m[2] ?? '').toLowerCase();
    if (!term) continue;
    if (!m[1] && term.startsWith('#') && term.length > 1) tags.push(term.slice(1));
    else words.push(term);
  }
  return { words, tags };
}

export interface SearchItem {
  /** Group the item is listed under and the filter chip that selects it. */
  kind: string;
  spaceId: string;
  id: string;
  /** What the result shows; a match here ranks highest. */
  title: string;
  /** Secondary names matched like the title (path, project, client). */
  names?: readonly string[];
  /** Searched, and the source of the snippet. */
  text?: string;
  tags?: readonly string[];
}

export interface SearchResult<T extends SearchItem = SearchItem> {
  item: T;
  snippet: string;
  score: number;
}

function snippetAt(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 40);
  const end = Math.min(text.length, index + length + 60);
  return (start > 0 ? '…' : '') + text.slice(start, end).replace(/\s+/g, ' ').trim() + (end < text.length ? '…' : '');
}

/**
 * Items holding every word (title, names, text or the space's name) and every `#tag`, best first:
 * a title with all the words +100, a word in the title +10, in a name +5, in the text +1.
 * `spaceNames` maps a space id to its name, so a space name can be searched.
 */
export function rankItems<T extends SearchItem>(items: readonly T[], query: string, spaceNames: ReadonlyMap<string, string> = new Map(), limit = 200): SearchResult<T>[] {
  const { words, tags } = queryTerms(query);
  if (words.length === 0 && tags.length === 0) return [];
  const out: SearchResult<T>[] = [];
  for (const item of items) {
    const itemTags = (item.tags ?? []).map((t) => t.toLowerCase());
    if (!tags.every((t) => itemTags.some((x) => x === t || x.startsWith(t + '/')))) continue;
    const title = item.title.toLowerCase();
    const names = (item.names ?? []).map((n) => n.toLowerCase());
    const text = (item.text ?? '').toLowerCase();
    const space = (spaceNames.get(item.spaceId) ?? '').toLowerCase();
    let score = words.length > 0 && words.every((w) => title.includes(w)) ? 100 : 0;
    let first = -1;
    let firstLen = 0;
    let all = true;
    for (const w of words) {
      const at = text.indexOf(w);
      if (title.includes(w)) score += 10;
      else if (names.some((n) => n.includes(w))) score += 5;
      else if (at !== -1) score += 1;
      else if (space.includes(w)) score += 0.1;
      else {
        all = false;
        break;
      }
      if (at !== -1 && (first === -1 || at < first)) {
        first = at;
        firstLen = w.length;
      }
    }
    if (!all) continue;
    out.push({ item, snippet: first === -1 ? '' : snippetAt(item.text ?? '', first, firstLen), score });
  }
  out.sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title));
  return out.slice(0, limit);
}
