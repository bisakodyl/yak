import { type FrontMatterValue, parseNote, propertyEdit, applyEdit } from './frontmatter';
import { extractInlineTags, frontMatterTags, maskCode } from './links';

/**
 * Rename or remove a tag in a note's text: the front matter `tags` property (a list or a string) and
 * inline `#tags`. Code is skipped, like links. Only the tag's own characters change, so the rest of
 * the text, and edits other devices make elsewhere in it, merge.
 */

const INLINE = /(^|[\s(,;])#([\p{L}\p{N}_\-/]+)/gu;

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Replace `from` by `to` (or drop it when `to` is null) in a list of tags, keeping `#` prefixes and dropping duplicates. */
function rewriteList(items: readonly unknown[], from: string, to: string | null): { list: unknown[]; changed: boolean } {
  const out: unknown[] = [];
  const seen = new Set<string>();
  let changed = false;
  for (const item of items) {
    if (typeof item !== 'string') {
      out.push(item);
      continue;
    }
    const hash = item.trim().startsWith('#') ? '#' : '';
    const bare = item.trim().replace(/^#/, '');
    let next = item;
    if (same(bare, from)) {
      changed = true;
      if (to === null) continue;
      next = hash + to;
    }
    const key = next.trim().replace(/^#/, '').toLowerCase();
    if (seen.has(key)) {
      changed = true;
      continue;
    }
    seen.add(key);
    out.push(next);
  }
  return { list: out, changed };
}

function frontMatterValue(value: FrontMatterValue, from: string, to: string | null): { value: FrontMatterValue | undefined; changed: boolean } | null {
  if (Array.isArray(value)) {
    const { list, changed } = rewriteList(value, from, to);
    return changed ? { value: list.length > 0 ? list : undefined, changed } : null;
  }
  if (typeof value === 'string') {
    const separator = value.includes(',') ? ', ' : ' ';
    const { list, changed } = rewriteList(value.split(/[,\s]+/).filter(Boolean), from, to);
    return changed ? { value: list.length > 0 ? list.join(separator) : undefined, changed } : null;
  }
  return null;
}

/** The text with `from` renamed to `to` (or removed when `to` is null) everywhere it is a tag. */
export function rewriteTag(text: string, from: string, to: string | null): string {
  const parsed = parseNote(text);
  let out = text;
  if (parsed.block && !parsed.error && 'tags' in parsed.properties) {
    const next = frontMatterValue(parsed.properties.tags, from, to);
    if (next) {
      const edit = propertyEdit(out, 'tags', next.value);
      if (edit) out = applyEdit(out, edit);
    }
  }
  const bodyStart = parseNote(out).block?.bodyStart ?? 0;
  const masked = maskCode(out);
  const edits: { from: number; to: number; text: string }[] = [];
  INLINE.lastIndex = bodyStart;
  let m: RegExpExecArray | null;
  while ((m = INLINE.exec(masked))) {
    if (m.index < bodyStart) continue;
    const name = m[2]!.replace(/\/+$/, '');
    if (!same(name, from)) continue;
    const start = m.index + m[1]!.length;
    const end = start + 1 + name.length;
    if (to !== null) edits.push({ from: start, to: end, text: `#${to}` });
    else {
      // Take one of the spaces around a removed tag with it, so no gap is left.
      const before = out[start - 1];
      const after = out[end];
      if (before === ' ' && (after === undefined || after === '\n')) edits.push({ from: start - 1, to: end, text: '' });
      else if (after === ' ') edits.push({ from: start, to: end + 1, text: '' });
      else edits.push({ from: start, to: end, text: '' });
    }
  }
  for (const e of edits.reverse()) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return out;
}

/** The text with `tag` added to the front matter `tags` (a list stays a list, a string stays a string); unchanged when it already has the tag anywhere or the tags are not editable. */
export function addTag(text: string, tag: string): string {
  const name = tag.trim().replace(/^#/, '');
  if (!name) return text;
  const parsed = parseNote(text);
  if (parsed.error) return text;
  if (frontMatterTags(parsed.properties.tags).some((t) => same(t, name)) || extractInlineTags(parsed.body).some((t) => same(t, name))) return text;
  const current = parsed.properties.tags;
  let next: unknown;
  if (current === undefined || current === null || current === '') next = [name];
  else if (Array.isArray(current)) next = [...current, name];
  else if (typeof current === 'string') next = `${current}${current.includes(',') ? ', ' : ' '}${name}`;
  else return text;
  const edit = propertyEdit(text, 'tags', next);
  return edit ? applyEdit(text, edit) : text;
}
