import type * as Y from 'yjs';
import { makeResolver, type WikiLink } from './links';
import { moveNotes, noteText } from './note-store';
import { splitPath } from './paths';

/**
 * Keeping links working when notes are renamed or moved (owner, 2026-10-17): the links that pointed at
 * a moved note, and the links in a moved note, are rewritten so they still reach the same notes, in the
 * shortest form that is not ambiguous (as Obsidian does), or in full-path form when they were written
 * that way. A person can leave this automatic, be offered the fix after the move, or turn it off.
 */

export type LinkMode = 'auto' | 'ask' | 'off';

export function readLinkMode(account: Y.Doc | undefined): LinkMode {
  const v = account?.getMap<unknown>('settings').get('link_update');
  return v === 'ask' || v === 'off' ? v : 'auto';
}

export function writeLinkMode(account: Y.Doc, mode: LinkMode): void {
  account.getMap<unknown>('settings').set('link_update', mode);
}

export interface LinkNote {
  id: string;
  path: string;
  text: string;
  links: readonly WikiLink[];
}

export interface PathMove {
  id: string;
  /** The note's new path. */
  path: string;
}

/** Replace `[from, to)` of a note's text by `text`; `expect` is what must be there, so a stale plan is skipped. */
export interface LinkEdit {
  noteId: string;
  from: number;
  to: number;
  expect: string;
  text: string;
}

const stripMd = (path: string): string => path.replace(/\.md$/i, '');

/** The shortest spelling of `path` that resolves back to `id` from `fromPath`; the full path when none does. */
export function spellingFor(id: string, path: string, resolve: ReturnType<typeof makeResolver>, fromPath: string, fullPath: boolean): string {
  const segs = splitPath(stripMd(path));
  if (!fullPath) {
    for (let k = 1; k < segs.length; k++) {
      const candidate = segs.slice(segs.length - k).join('/');
      if (resolve(candidate, fromPath)?.id === id) return candidate;
    }
  }
  return segs.join('/');
}

/**
 * The edits that keep every link working when `moves` are made. `notes` is the state before the move
 * (paths and texts as they are now). A link that still reaches the same note needs no edit.
 */
export function planLinkUpdates(notes: readonly LinkNote[], moves: readonly PathMove[]): LinkEdit[] {
  if (moves.length === 0) return [];
  const newPath = new Map(moves.map((m) => [m.id, m.path]));
  const before = makeResolver(notes);
  const after = makeResolver(notes.map((n) => ({ id: n.id, path: newPath.get(n.id) ?? n.path })));
  const edits: LinkEdit[] = [];
  for (const n of notes) {
    const fromAfter = newPath.get(n.id) ?? n.path;
    for (const l of n.links) {
      if (!l.target) continue;
      const hit = before(l.target, n.path);
      if (!hit) continue;
      if (!newPath.has(hit.id) && !newPath.has(n.id)) continue;
      if (after(l.target, fromAfter)?.id === hit.id) continue;
      const target = spellingFor(hit.id, newPath.get(hit.id) ?? hit.path, after, fromAfter, l.target.includes('/'));
      const inner = target + (l.heading ? `#${l.heading}` : '') + (l.alias ? `|${l.alias}` : '');
      const text = `${l.embed ? '!' : ''}[[${inner}]]`;
      const expect = n.text.slice(l.from, l.to);
      if (text !== expect) edits.push({ noteId: n.id, from: l.from, to: l.to, expect, text });
    }
  }
  return edits;
}

export interface LinkResult {
  links: number;
  notes: number;
}

export function summarise(edits: readonly LinkEdit[]): LinkResult {
  return { links: edits.length, notes: new Set(edits.map((e) => e.noteId)).size };
}

/** Apply edits to the notes' texts in one transaction; an edit whose text no longer matches is skipped. */
export function applyLinkEdits(doc: Y.Doc, edits: readonly LinkEdit[]): LinkResult {
  const done: LinkEdit[] = [];
  doc.transact(() => {
    const byNote = new Map<string, LinkEdit[]>();
    for (const e of edits) byNote.set(e.noteId, [...(byNote.get(e.noteId) ?? []), e]);
    for (const [id, list] of byNote) {
      const ytext = noteText(doc, id);
      if (!ytext) continue;
      // From the end of the text, so earlier offsets stay right.
      for (const e of [...list].sort((a, b) => b.from - a.from)) {
        if (ytext.toString().slice(e.from, e.to) !== e.expect) continue;
        ytext.delete(e.from, e.to - e.from);
        ytext.insert(e.from, e.text);
        done.push(e);
      }
    }
  });
  return summarise(done);
}

/**
 * Move notes, and in `auto` mode fix the links in the same transaction. Returns the planned edits, so the
 * caller can offer them (`ask`) or report them.
 */
export function moveWithLinks(doc: Y.Doc, notes: readonly LinkNote[], moves: readonly PathMove[], mode: LinkMode): LinkEdit[] {
  const edits = mode === 'off' ? [] : planLinkUpdates(notes, moves);
  doc.transact(() => {
    moveNotes(doc, moves);
    if (mode === 'auto') applyLinkEdits(doc, edits);
  });
  return edits;
}
