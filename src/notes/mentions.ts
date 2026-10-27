import { maskCode, type Resolver, type WikiLink } from './links';
import { noteTitle, type PathItem } from './paths';

export interface MentionSource extends PathItem {
  text: string;
  links: readonly WikiLink[];
}

/** Names shorter than this match too much ("a", "to") to be useful. */
const MIN_MENTION_LENGTH = 3;

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Notes whose text names `target` (its title, as a whole word, any case) without linking to it, each
 * with the number of mentions. Code and existing `[[links]]` are not searched.
 */
export function unlinkedMentions(target: PathItem, notes: readonly MentionSource[], resolve: Resolver): { id: string; path: string; count: number }[] {
  const title = noteTitle(target.path);
  if (title.length < MIN_MENTION_LENGTH) return [];
  const word = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(title)}(?![\\p{L}\\p{N}_])`, 'giu');
  const out: { id: string; path: string; count: number }[] = [];
  for (const n of notes) {
    if (n.id === target.id) continue;
    if (n.links.some((l) => l.target && resolve(l.target, n.path)?.id === target.id)) continue;
    const chars = maskCode(n.text).split('');
    for (const l of n.links) for (let i = l.from; i < l.to; i++) if (chars[i] !== '\n') chars[i] = ' ';
    const count = chars.join('').match(word)?.length ?? 0;
    if (count > 0) out.push({ id: n.id, path: n.path, count });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
