import { extractLinks } from '../../src/notes/links';
import { parseSpaceTarget } from '../../src/notes/space-move';

/**
 * Cross-space links between the app and the vault (#64). In a note, a link into another space is
 * `[[Space name:path]]`; in the vault every space is a folder under the root, so the same link is
 * `[[Yak/<folder>/path|title]]` and Obsidian resolves, renames and previews it. Links are
 * translated when a file is written and again when it is read, so the note text never holds vault
 * paths and the file never holds `Space:` prefixes.
 */

export interface LinkSpace {
  id: string;
  name: string;
  /** The space's folder under the root. */
  folder: string;
  /** Paths of the space's notes, for finding names that exist in several spaces. */
  paths: readonly string[];
}

const stripMd = (p: string): string => p.replace(/\.md$/i, '');
const baseOf = (p: string): string => stripMd(p.slice(p.lastIndexOf('/') + 1));

/** Rewrites each link with `edit`; a null result keeps it. Edits are applied from the end. */
function rewrite(text: string, edit: (target: string, heading: string | null, alias: string | null, embed: boolean) => string | null): string {
  let out = text;
  for (const l of extractLinks(text).reverse()) {
    if (!l.target) continue;
    const replaced = edit(l.target, l.heading, l.alias, l.embed);
    if (replaced !== null) out = out.slice(0, l.from) + replaced + out.slice(l.to);
  }
  return out;
}

function build(embed: boolean, target: string, heading: string | null, alias: string | null): string {
  return `${embed ? '!' : ''}[[${target}${heading ? `#${heading}` : ''}${alias ? `|${alias}` : ''}]]`;
}

/** Links of a note in `current` as they are written into its file. */
export function toVaultLinks(text: string, root: string, current: LinkSpace, spaces: readonly LinkSpace[]): string {
  if (!text.includes('[[')) return text;
  const names = spaces.map((s) => s.name);
  const others = spaces.filter((s) => s.id !== current.id);
  return rewrite(text, (target, heading, alias, embed) => {
    const parsed = parseSpaceTarget(target, names);
    if (parsed.space !== null) {
      const space = spaces.find((s) => s.name.toLowerCase() === parsed.space!.toLowerCase());
      if (!space) return null;
      return build(embed, `${root}/${space.folder}/${parsed.rest}`, heading, alias ?? baseOf(parsed.rest));
    }
    // A name that also exists in another space would be ambiguous vault-wide: spell out the folder.
    const key = baseOf(target).toLowerCase();
    const own = current.paths.some((p) => p.toLowerCase() === `${stripMd(target).toLowerCase()}.md` || baseOf(p).toLowerCase() === key);
    const clash = others.some((s) => s.paths.some((p) => baseOf(p).toLowerCase() === key));
    if (!own || !clash) return null;
    const exact = current.paths.find((p) => stripMd(p).toLowerCase() === stripMd(target).toLowerCase());
    return build(embed, `${root}/${current.folder}/${exact ? stripMd(exact) : target}`, heading, alias ?? baseOf(target));
  });
}

/** Links of a file in `current` as they are stored in its note. */
export function fromVaultLinks(text: string, root: string, current: LinkSpace, spaces: readonly LinkSpace[]): string {
  if (!text.includes('[[')) return text;
  const prefix = `${root}/`.toLowerCase();
  return rewrite(text, (target, heading, alias, embed) => {
    if (!target.toLowerCase().startsWith(prefix)) return null;
    const inner = target.slice(prefix.length);
    const slash = inner.indexOf('/');
    if (slash <= 0) return null;
    const space = spaces.find((s) => s.folder.toLowerCase() === inner.slice(0, slash).toLowerCase());
    if (!space) return null;
    const rest = inner.slice(slash + 1);
    // The title written for the vault is dropped again when it is only the note's name.
    const keep = alias !== null && alias !== baseOf(rest) ? alias : null;
    return build(embed, space.id === current.id ? rest : `${space.name}:${rest}`, heading, keep);
  });
}
