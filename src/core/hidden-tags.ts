import type * as Y from 'yjs';

/**
 * Tags hidden from pickers, per space (owner, 2026-10-17). A hidden tag still shows on the items that
 * have it and in reports; hiding only takes it off the lists offered when adding a tag.
 * Stored in the space's main document, `hidden_tags`: lower-case name → true or false.
 */
function map(doc: Y.Doc): Y.Map<boolean> {
  return doc.getMap<boolean>('hidden_tags');
}

export function hiddenTags(doc: Y.Doc): Set<string> {
  const out = new Set<string>();
  map(doc).forEach((v, k) => {
    if (v === true) out.add(k);
  });
  return out;
}

export function setTagHidden(doc: Y.Doc, name: string, hidden: boolean): void {
  map(doc).set(name.trim().toLowerCase(), hidden);
}

/** `names` without the hidden ones, for the lists pickers offer. */
export function visibleTags(doc: Y.Doc, names: readonly string[]): string[] {
  const hidden = hiddenTags(doc);
  return names.filter((n) => !hidden.has(n.toLowerCase()));
}
