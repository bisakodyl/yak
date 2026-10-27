import type * as Y from 'yjs';
import { STORAGE_PREFIX } from '../constants';
import { setKeeps } from './keeps';
import type { SpaceId, SpaceInfo } from './spaces';

/**
 * The account: the owner's devices and what they share. See docs/sync.md.
 *
 * An account exists only on its devices. Its document `account/<id>` holds the list of spaces
 * (with their names), device names and removals (`devices` map, see devices.ts) and personal
 * settings (`settings` map, see settings.ts). Every device of the account holds it.
 *
 * All values are plain and keyed per field (`<spaceId>:name`), so two devices changing different
 * fields at once never drop each other's change.
 */

export type AccountId = string;

const META = 'account';
const SPACES = 'spaces';

/** Where this device remembers which account it belongs to. */
export const CURRENT_ACCOUNT_KEY = `${STORAGE_PREFIX}-account`;

/** The id an account had before it moved to its key's fingerprint (#255): set by the move, cleared by the next start once it folded the old document in (#295). */
export const LEGACY_ACCOUNT_KEY = `${STORAGE_PREFIX}-account-legacy`;

export function accountDocId(id: AccountId): string {
  return `account/${id}`;
}

/** The account id of an `account/<id>` document id, or undefined. */
export function accountOfDoc(docId: string): AccountId | undefined {
  const m = /^account\/([a-f0-9]{24})$/.exec(docId);
  return m ? m[1] : undefined;
}

/** The account's shared debug log document (docs/sync.md): every device of the account writes and reads it. */
export function accountLogDocId(id: AccountId): string {
  return `account/${id}/log`;
}

/** The account id of an `account/<id>/log` document id, or undefined. */
export function accountOfLogDoc(docId: string): AccountId | undefined {
  const m = /^account\/([a-f0-9]{24})\/log$/.exec(docId);
  return m ? m[1] : undefined;
}

/** 24 hex characters: a new account or space id. */
export function randomId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** A stable id from text, so several devices derive the same id without talking (24 hex characters). */
export async function derivedId(...parts: string[]): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u0000')));
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function initAccountDoc(doc: Y.Doc, id: AccountId, now = new Date().toISOString()): void {
  const meta = doc.getMap<unknown>(META);
  // `meta.id` is the id the document was created under. It is informational: nothing reads it, and a moved account's copy keeps the old value (the bridge shares one state with the old document, which older builds also write).
  if (meta.get('id') !== undefined) return;
  doc.transact(() => {
    meta.set('id', id);
    if (!meta.has('created_at')) meta.set('created_at', now);
  });
}

export function spacesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(SPACES);
}

export interface AccountSpace extends SpaceInfo {
  /** The stored name; `name` adds " (2)" while two spaces share a name. */
  storedName: string;
  createdAt: string;
  /** Hidden from pickers and lists; still synced and kept. */
  archived: boolean;
}

/** Live spaces of the account, oldest first. Names that collide (renamed apart on two devices) get " (2)", " (3)". */
export function readSpaces(doc: Y.Doc | undefined): AccountSpace[] {
  if (!doc) return [];
  const byId = new Map<string, { name?: string; createdAt?: string; deleted?: boolean; archived?: boolean }>();
  spacesMap(doc).forEach((value, key) => {
    const i = key.lastIndexOf(':');
    if (i <= 0) return;
    const id = key.slice(0, i);
    const field = key.slice(i + 1);
    const rec = byId.get(id) ?? {};
    if (field === 'name' && typeof value === 'string') rec.name = value;
    if (field === 'created_at' && typeof value === 'string') rec.createdAt = value;
    if (field === 'deleted') rec.deleted = value === true;
    if (field === 'archived') rec.archived = value === true;
    byId.set(id, rec);
  });
  const live = [...byId.entries()]
    .filter(([, r]) => !r.deleted && r.name)
    .map(([id, r]) => ({ id, storedName: r.name as string, createdAt: r.createdAt ?? '', archived: r.archived === true }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));
  const seen = new Map<string, number>();
  return live.map((s) => {
    const key = s.storedName.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    return { ...s, name: n === 1 ? s.storedName : `${s.storedName} (${n})` };
  });
}

function cleanSpaceName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, 60);
}

/** Why a name cannot be used for `spaceId` (undefined when it can). Names are unique in an account, ignoring case. */
export function spaceNameProblem(doc: Y.Doc, name: string, spaceId?: SpaceId): string | undefined {
  const clean = cleanSpaceName(name);
  if (!clean) return 'Enter a name.';
  const taken = readSpaces(doc).find((s) => s.id !== spaceId && s.storedName.toLowerCase() === clean.toLowerCase());
  return taken ? `There is already a space called ${taken.storedName}.` : undefined;
}

/**
 * Add a space; refuses a name in use. `keptBy` is the device that creates it, which keeps it (other
 * devices keep it only when chosen). Returns the error, or undefined.
 */
export function addSpace(doc: Y.Doc, id: SpaceId, name: string, createdAt = new Date().toISOString(), keptBy?: string): string | undefined {
  const problem = spaceNameProblem(doc, name, id);
  if (problem) return problem;
  doc.transact(() => {
    spacesMap(doc).set(`${id}:name`, cleanSpaceName(name));
    if (!spacesMap(doc).has(`${id}:created_at`)) spacesMap(doc).set(`${id}:created_at`, createdAt);
    if (keptBy) setKeeps(doc, keptBy, id, true);
  });
  return undefined;
}

export function renameSpace(doc: Y.Doc, id: SpaceId, name: string): string | undefined {
  if (!spacesMap(doc).has(`${id}:name`)) return 'That space no longer exists.';
  const problem = spaceNameProblem(doc, name, id);
  if (problem) return problem;
  spacesMap(doc).set(`${id}:name`, cleanSpaceName(name));
  return undefined;
}

/** A free name based on `name`: "Personal", then "Personal (phone)", then "Personal 2"… */
export function freeSpaceName(doc: Y.Doc, name: string, hint?: string): string {
  if (!spaceNameProblem(doc, name)) return cleanSpaceName(name);
  if (hint && !spaceNameProblem(doc, `${name} (${hint})`)) return cleanSpaceName(`${name} (${hint})`);
  for (let i = 2; ; i++) if (!spaceNameProblem(doc, `${name} ${i}`)) return cleanSpaceName(`${name} ${i}`);
}

/** A new space with a fresh id, kept by `keptBy`. Returns the id, or the problem with the name. */
export function createSpace(doc: Y.Doc, name: string, keptBy: string): { id: SpaceId } | { error: string } {
  const id = randomId();
  const error = addSpace(doc, id, name, undefined, keptBy);
  return error ? { error } : { id };
}

/** Why the space cannot be archived or removed: the account keeps at least one active space. */
function lastActiveProblem(doc: Y.Doc, id: SpaceId): string | undefined {
  const others = readSpaces(doc).filter((s) => s.id !== id && !s.archived);
  return others.length === 0 ? 'The account needs at least one space that is not archived.' : undefined;
}

/** Hide a space from pickers and lists, or show it again. It stays kept and synced. Returns the problem, or undefined. */
export function setArchived(doc: Y.Doc, id: SpaceId, archived: boolean): string | undefined {
  if (!readSpaces(doc).some((s) => s.id === id)) return 'That space no longer exists.';
  if (archived) {
    const problem = lastActiveProblem(doc, id);
    if (problem) return problem;
  }
  spacesMap(doc).set(`${id}:archived`, archived);
  return undefined;
}

/** Remove the space from the account: every device stops keeping it. Its data stays in backups and history. */
export function removeSpace(doc: Y.Doc, id: SpaceId): string | undefined {
  if (!readSpaces(doc).some((s) => s.id === id)) return 'That space no longer exists.';
  const problem = lastActiveProblem(doc, id);
  if (problem) return problem;
  spacesMap(doc).set(`${id}:deleted`, true);
  return undefined;
}
