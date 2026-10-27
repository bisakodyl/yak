import * as Y from 'yjs';
import type { BulkTx } from '../core/bulk';
import { collection, nowIso } from '../core/schema';
import { type LinkEdit, type LinkMode, moveWithLinks, type PathMove } from './link-update';
import { type FrontMatterValue, minimalEdit, parseNote } from './frontmatter';
import { buildIndex, deleteNote, noteText, setNoteProperties } from './note-store';
import { planMove, type PathItem } from './paths';
import { copyBlobs } from '../core/blobs/copy';
import { moveToSpace, planSpacePaths } from './space-move';
import { addTag, rewriteTag } from './tag-rewrite';

/**
 * Changing many notes and tasks at once. Each function takes the spaces' documents by space id and
 * the chosen notes, and runs inside the bulk transaction (`tx` from `bulkEdit`) so one action is one
 * Undo. Notes are edited in the space they live in; a move to a folder or another space keeps links
 * working as chosen in Settings › Links.
 */
export type Docs = ReadonlyMap<string, Y.Doc>;
export interface NoteTarget {
  spaceId: string;
  id: string;
}
export interface Outcome {
  changed: number;
  /** Chosen notes left as they were (nothing to change, a name clash, front matter that cannot be edited). */
  skipped: number;
}

function rewrite(docs: Docs, targets: readonly NoteTarget[], tx: BulkTx, fn: (text: string) => string): Outcome {
  let changed = 0;
  let skipped = 0;
  for (const t of targets) {
    const doc = docs.get(t.spaceId);
    const rec = doc ? collection(doc, 'notes').get(t.id) : undefined;
    const ytext = rec?.get('text');
    if (!doc || !rec || rec.get('deleted') === true || !(ytext instanceof Y.Text)) {
      skipped++;
      continue;
    }
    const old = ytext.toString();
    const next = fn(old);
    if (next === old) {
      skipped++;
      continue;
    }
    tx(doc, () => {
      const e = minimalEdit(old, next);
      if (e.remove > 0) ytext.delete(e.index, e.remove);
      if (e.insert) ytext.insert(e.index, e.insert);
      rec.set('updated_at', nowIso());
    });
    changed++;
  }
  return { changed, skipped };
}

export function addTagTo(docs: Docs, targets: readonly NoteTarget[], tag: string, tx: BulkTx): Outcome {
  return rewrite(docs, targets, tx, (text) => addTag(text, tag));
}

export function removeTagFrom(docs: Docs, targets: readonly NoteTarget[], tag: string, tx: BulkTx): Outcome {
  const name = tag.trim().replace(/^#/, '');
  return name ? rewrite(docs, targets, tx, (text) => rewriteTag(text, name, null)) : { changed: 0, skipped: targets.length };
}

/** Set front matter properties (undefined removes one) on every chosen note. */
export function setProperties(docs: Docs, targets: readonly NoteTarget[], changes: Record<string, FrontMatterValue | undefined>, tx: BulkTx): Outcome {
  let changed = 0;
  let skipped = 0;
  for (const t of targets) {
    const doc = docs.get(t.spaceId);
    let ok = false;
    if (doc && collection(doc, 'notes').get(t.id)?.get('deleted') !== true) tx(doc, () => void (ok = setNoteProperties(doc, t.id, changes)));
    if (ok) changed++;
    else skipped++;
  }
  return { changed, skipped };
}

const DATE_VALUE = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;
const pad = (n: number): string => String(n).padStart(2, '0');

/** `value` moved by whole days, keeping a time part; null when it is not a date. */
export function shiftDateValue(value: unknown, days: number): string | null {
  if (typeof value !== 'string') return null;
  const m = DATE_VALUE.exec(value);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}${m[4] ?? ''}`;
}

/** Move a date property (`due`, `scheduled`) by days. Notes without a date there are left as they are. */
export function shiftDate(docs: Docs, targets: readonly NoteTarget[], key: string, days: number, tx: BulkTx): Outcome {
  let changed = 0;
  let skipped = 0;
  for (const t of targets) {
    const doc = docs.get(t.spaceId);
    const text = doc ? noteText(doc, t.id)?.toString() : undefined;
    const next = text === undefined ? null : shiftDateValue(parseNote(text).properties[key], days);
    let ok = false;
    if (doc && next !== null) tx(doc, () => void (ok = setNoteProperties(doc, t.id, { [key]: next })));
    if (ok) changed++;
    else skipped++;
  }
  return { changed, skipped };
}

/** Set a date property to one day, keeping a time part the note had; `null` removes it. */
export function setDate(docs: Docs, targets: readonly NoteTarget[], key: string, date: string | null, tx: BulkTx): Outcome {
  let changed = 0;
  let skipped = 0;
  for (const t of targets) {
    const doc = docs.get(t.spaceId);
    const text = doc ? noteText(doc, t.id)?.toString() : undefined;
    if (!doc || text === undefined) {
      skipped++;
      continue;
    }
    const old = parseNote(text).properties[key];
    const time = typeof old === 'string' ? (DATE_VALUE.exec(old)?.[4] ?? '') : '';
    const value = date === null ? undefined : `${date}${time}`;
    let ok = false;
    if (old !== value) tx(doc, () => void (ok = setNoteProperties(doc, t.id, { [key]: value })));
    if (ok) changed++;
    else skipped++;
  }
  return { changed, skipped };
}

export function deleteNotes(docs: Docs, targets: readonly NoteTarget[], tx: BulkTx): Outcome {
  let changed = 0;
  for (const t of targets) {
    const doc = docs.get(t.spaceId);
    if (doc && collection(doc, 'notes').get(t.id)?.get('deleted') !== true) {
      tx(doc, () => void deleteNote(doc, t.id));
      changed++;
    }
  }
  return { changed, skipped: targets.length - changed };
}

/** New paths for notes moved into `folder`, planned one after another so two notes with the same name do not both go. */
export function planFolderMove(notes: readonly PathItem[], ids: readonly string[], folder: string): { moves: PathMove[]; skipped: number; error: string | null } {
  let working = notes.map((n) => ({ ...n }));
  const moves: PathMove[] = [];
  let skipped = 0;
  let error: string | null = null;
  for (const id of ids) {
    const plan = planMove(working, { kind: 'note', id }, folder);
    if (!plan.ok) {
      skipped++;
      error = plan.error;
      continue;
    }
    if (plan.moves.length === 0) {
      skipped++;
      continue;
    }
    moves.push(...plan.moves);
    const moved = new Map(plan.moves.map((m) => [m.id, m.path]));
    working = working.map((n) => (moved.has(n.id) ? { ...n, path: moved.get(n.id) as string } : n));
  }
  return { moves, skipped, error };
}

export interface MoveOutcome extends Outcome {
  /** Link edits planned but not applied (mode `ask`), per space, for a "Fix links" action. */
  pending: { doc: Y.Doc; edits: LinkEdit[] }[];
  /** Links rewritten (auto) or found (ask). */
  links: number;
  error: string | null;
}

/** Move notes into a folder of their own space; links follow as `mode` says. */
export function moveToFolder(docs: Docs, targets: readonly NoteTarget[], folder: string, mode: LinkMode, tx: BulkTx): MoveOutcome {
  const out: MoveOutcome = { changed: 0, skipped: 0, pending: [], links: 0, error: null };
  const bySpace = new Map<string, string[]>();
  for (const t of targets) bySpace.set(t.spaceId, [...(bySpace.get(t.spaceId) ?? []), t.id]);
  for (const [spaceId, ids] of bySpace) {
    const doc = docs.get(spaceId);
    if (!doc) {
      out.skipped += ids.length;
      continue;
    }
    const before = buildIndex(doc).notes;
    const plan = planFolderMove(before, ids, folder);
    out.skipped += plan.skipped;
    out.error = plan.error ?? out.error;
    if (plan.moves.length === 0) continue;
    let edits: LinkEdit[] = [];
    tx(doc, () => void (edits = moveWithLinks(doc, before, plan.moves, mode)));
    out.changed += plan.moves.length;
    out.links += edits.length;
    if (mode === 'ask' && edits.length > 0) out.pending.push({ doc, edits });
  }
  return out;
}

export interface SpaceMoveOutcome extends MoveOutcome {
  /** Moves every note back, with links rewritten the same way. */
  undo(): void;
}

/**
 * Move notes to another space (copy there, delete here, links fixed as `mode` says), one space at a
 * time. Uses the same move as one note (`moveToSpace`), so its link rules and its Undo apply.
 */
export function moveToOtherSpace(docs: Docs, names: (spaceId: string) => string, targets: readonly NoteTarget[], toSpace: string, folder: string, mode: LinkMode): SpaceMoveOutcome {
  const dstDoc = docs.get(toSpace);
  const out: SpaceMoveOutcome = { changed: 0, skipped: 0, pending: [], links: 0, error: null, undo: () => undefined };
  const undos: (() => void)[] = [];
  const bySpace = new Map<string, string[]>();
  for (const t of targets) bySpace.set(t.spaceId, [...(bySpace.get(t.spaceId) ?? []), t.id]);
  if (!dstDoc) return { ...out, skipped: targets.length };
  for (const [spaceId, ids] of bySpace) {
    const src = docs.get(spaceId);
    if (!src || spaceId === toSpace) {
      out.skipped += ids.length;
      continue;
    }
    const srcNotes = buildIndex(src).notes;
    let dstNotes = buildIndex(dstDoc).notes;
    const moves: PathMove[] = [];
    for (const id of ids) {
      const plan = planSpacePaths(srcNotes, dstNotes, { kind: 'note', id }, folder);
      if (!plan.ok) {
        out.skipped++;
        out.error = plan.error;
        continue;
      }
      moves.push(...plan.moves);
      dstNotes = [...dstNotes, ...plan.moves.map((m) => ({ ...(srcNotes.find((n) => n.id === m.id) as (typeof srcNotes)[number]), path: m.path }))];
    }
    if (moves.length === 0) continue;
    const result = moveToSpace(src, dstDoc, { src: names(spaceId), dst: names(toSpace) }, moves, null, mode);
    void copyBlobs(spaceId, toSpace, result.files);
    undos.push(result.undo);
    out.changed += moves.length;
    out.links += result.edits.length;
    if (mode === 'ask' && result.edits.length > 0) {
      out.pending.push({ doc: src, edits: result.edits.filter((e) => e.in === 'src') }, { doc: dstDoc, edits: result.edits.filter((e) => e.in === 'dst') });
    }
  }
  out.undo = () => {
    for (const u of undos.reverse()) u();
  };
  return out;
}
