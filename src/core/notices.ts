/**
 * Sync notices: merges worth a look (two notes on one path, a timer stopped by the one-timer rule,
 * a bulk change from another device). Kept on this device only, never in a document, so each device
 * decides what it has seen. A notice has a stable `key`; once added it is never added again, even
 * after it is dismissed, so a conflict that stays in the data does not come back on every start.
 */
import type { CollectionName } from './schema';

type NoticeKind = 'path-conflict' | 'timer-stopped' | 'bulk-change' | 'field-conflict' | 'update-needed';

export interface Notice {
  key: string;
  kind: NoticeKind;
  at: number;
  text: string;
  /** Where to look: a note or an entry in a space. */
  spaceId?: string;
  noteId?: string;
  /** For `field-conflict`: what to set back for "Keep mine". */
  conflict?: { part: 'shared' | 'private'; collection: CollectionName; recordId: string; field: string; mine: unknown; theirs: unknown };
}

const KEY = 'app-sync-notices';
const MAX_SEEN = 500;
const MAX_NOTICES = 100;

interface Saved {
  open: Notice[];
  seen: string[];
}

function load(): Saved {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (parsed && Array.isArray(parsed.open) && Array.isArray(parsed.seen)) return { open: parsed.open, seen: parsed.seen };
  } catch {
    // No storage or damaged: start empty.
  }
  return { open: [], seen: [] };
}

let state = load();
const listeners = new Set<() => void>();

function commit(next: Saved): void {
  state = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // The list still works for this page's lifetime.
  }
  for (const l of listeners) l();
}

export function notices(): readonly Notice[] {
  return state.open;
}

/** Add a notice unless this key was seen before. Returns whether it was added. */
export function addNotice(n: Omit<Notice, 'at'> & { at?: number }): boolean {
  if (state.seen.includes(n.key)) return false;
  const notice: Notice = { ...n, at: n.at ?? Date.now() };
  commit({ open: [notice, ...state.open].slice(0, MAX_NOTICES), seen: [...state.seen, n.key].slice(-MAX_SEEN) });
  return true;
}

export function dismissNotice(key: string): void {
  commit({ ...state, open: state.open.filter((n) => n.key !== key) });
}

export function dismissAllNotices(): void {
  commit({ ...state, open: [] });
}

export function onNotices(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests only: forget everything. */
export function resetNotices(): void {
  commit({ open: [], seen: [] });
}
