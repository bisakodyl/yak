import { hasControlChars, isReservedName } from '../core/file-names';

/**
 * Note paths as in an Obsidian vault: `Folder/Sub/Name.md`. Folders exist only as path prefixes.
 */

/** Characters Obsidian and common file systems reject in file names. */
const BAD_CHARS = /[\\:*?"<>|#^[\]]/g;

export function splitPath(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

/** Clean up a user-entered path: forward slashes, no empty or dot segments, `.md` extension. */
export function normalizePath(input: string): string {
  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '.' && s !== '..');
  if (segments.length === 0) return '';
  const last = segments.length - 1;
  if (!/\.md$/i.test(segments[last]!)) segments[last] = `${segments[last]}.md`;
  return segments.join('/');
}

/** Why a path cannot be used, or null when it is fine. */
export function pathProblem(path: string): string | null {
  if (!path) return 'Enter a name';
  for (const seg of splitPath(path)) {
    const bad = seg.match(BAD_CHARS);
    if (bad) return `Names cannot contain ${[...new Set(bad)].join(' ')}`;
    if (hasControlChars(seg)) return 'Names cannot contain control characters';
    if (seg.startsWith('.')) return 'Names cannot start with a dot';
    if (isReservedName(seg)) return `${seg} is a reserved name on Windows`;
  }
  return null;
}

/** Make a title safe to use as a file name. */
export function safeName(title: string): string {
  const name = title.replace(BAD_CHARS, '-').replace(/\//g, '-').replace(/\s+/g, ' ').trim().replace(/^\.+/, '') || 'Untitled';
  const clean = [...name].map((c) => (hasControlChars(c) ? '-' : c)).join('');
  return isReservedName(clean) ? `${clean}-` : clean;
}

/** The note's display name: the file name without `.md`. */
export function noteTitle(path: string): string {
  const name = splitPath(path).pop() ?? path;
  return name.replace(/\.md$/i, '');
}

/** Folder part of a path, `''` for the vault root. */
export function folderOf(path: string): string {
  const segs = splitPath(path);
  segs.pop();
  return segs.join('/');
}

export function joinPath(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name;
}

/** Key used to compare paths: Obsidian vaults live on case-insensitive file systems too. */
export function pathKey(path: string): string {
  return normalizePath(path).toLowerCase();
}

/** A path not used by any of `taken`, adding ` 1`, ` 2`, … before `.md` when needed. */
export function uniquePath(path: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(pathKey));
  if (!used.has(pathKey(path))) return path;
  const base = path.replace(/\.md$/i, '');
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}.md`;
    if (!used.has(pathKey(candidate))) return candidate;
  }
}

export interface PathItem {
  id: string;
  path: string;
}

/** Ids grouped by path key, only for paths used by more than one note. */
export function pathConflicts(items: readonly PathItem[]): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const it of items) {
    const k = pathKey(it.path);
    byKey.set(k, [...(byKey.get(k) ?? []), it.id]);
  }
  for (const [k, ids] of byKey) if (ids.length < 2) byKey.delete(k);
  return byKey;
}

export interface FolderNode {
  name: string;
  /** Full folder path, `''` for the root. */
  path: string;
  folders: FolderNode[];
  notes: PathItem[];
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Build the folder tree from note paths; folders sorted before notes, both by name. */
export function buildTree(items: readonly PathItem[], emptyFolders: readonly string[] = []): FolderNode {
  const root: FolderNode = { name: '', path: '', folders: [], notes: [] };
  const index = new Map<string, FolderNode>([['', root]]);
  /** The node of a folder path, creating it and its parents. */
  const ensure = (segs: readonly string[]): FolderNode => {
    let node = root;
    let acc = '';
    for (const seg of segs) {
      acc = joinPath(acc, seg);
      let child = index.get(acc.toLowerCase());
      if (!child) {
        child = { name: seg, path: acc, folders: [], notes: [] };
        index.set(acc.toLowerCase(), child);
        node.folders.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const it of items) {
    const segs = splitPath(it.path);
    segs.pop();
    ensure(segs).notes.push(it);
  }
  // Folders kept on purpose (they exist even with no note in them).
  for (const f of emptyFolders) ensure(splitPath(f));
  const sort = (n: FolderNode): void => {
    n.folders.sort((a, b) => collator.compare(a.name, b.name));
    n.notes.sort((a, b) => collator.compare(noteTitle(a.path), noteTitle(b.path)) || collator.compare(a.path, b.path) || (a.id < b.id ? -1 : 1));
    n.folders.forEach(sort);
  };
  sort(root);
  return root;
}

/** New paths for every note inside `from` (a folder path) when the folder is renamed or moved to `to`. */
export function moveFolder(items: readonly PathItem[], from: string, to: string): { id: string; path: string }[] {
  const prefix = from.toLowerCase() + '/';
  const target = splitPath(to).join('/');
  const out: { id: string; path: string }[] = [];
  for (const it of items) {
    if (!it.path.toLowerCase().startsWith(prefix)) continue;
    out.push({ id: it.id, path: joinPath(target, it.path.slice(prefix.length)) });
  }
  return out;
}

/** Every folder path implied by the notes, sorted, without the root. */
export function allFolders(items: readonly PathItem[], emptyFolders: readonly string[] = []): string[] {
  const set = new Map<string, string>();
  const add = (segs: readonly string[]): void => {
    let acc = '';
    for (const s of segs) {
      acc = joinPath(acc, s);
      if (!set.has(acc.toLowerCase())) set.set(acc.toLowerCase(), acc);
    }
  };
  for (const it of items) {
    const segs = splitPath(it.path);
    segs.pop();
    add(segs);
  }
  for (const f of emptyFolders) add(splitPath(f));
  return [...set.values()].sort(collator.compare);
}

/** Where a folder ends up when moved into `targetFolder` ('' = top level): its name under the target. */
export function folderTarget(folderPath: string, targetFolder: string): string {
  const name = splitPath(folderPath).pop() ?? folderPath;
  return joinPath(splitPath(targetFolder.replace(/\\/g, '/')).join('/'), name);
}

/** What is being moved: one note, or a folder with everything in it. */
export type MoveSource = { kind: 'note'; id: string } | { kind: 'folder'; path: string };

export type MovePlan = { ok: true; moves: { id: string; path: string }[] } | { ok: false; error: string };

/**
 * New paths for moving a note or folder into `targetFolder` (`''` is the top level), as drag and
 * drop or "Move to…" does. Refuses moving a folder into itself, and any move onto a path another
 * note already has. Moving to where it already is gives no moves.
 */
export function planMove(items: readonly PathItem[], source: MoveSource, targetFolder: string): MovePlan {
  const target = splitPath(targetFolder.replace(/\\/g, '/')).join('/');
  const problem = target ? pathProblem(`${target}/x.md`) : null;
  if (problem) return { ok: false, error: problem };
  let moves: { id: string; path: string }[];
  if (source.kind === 'note') {
    const item = items.find((i) => i.id === source.id);
    if (!item) return { ok: false, error: 'That note no longer exists' };
    const name = splitPath(item.path).pop() ?? item.path;
    const path = joinPath(target, name);
    moves = pathKey(path) === pathKey(item.path) ? [] : [{ id: item.id, path }];
  } else {
    const from = splitPath(source.path).join('/');
    const name = splitPath(from).pop() ?? from;
    const to = joinPath(target, name);
    const lower = (x: string): string => x.toLowerCase();
    if (lower(`${target}/`).startsWith(lower(`${from}/`))) return { ok: false, error: 'A folder cannot be moved into itself' };
    moves = lower(to) === lower(from) ? [] : moveFolder(items, from, to);
  }
  const moving = new Set(moves.map((m) => m.id));
  const taken = new Set(items.filter((i) => !moving.has(i.id)).map((i) => pathKey(i.path)));
  const clash = moves.find((m) => taken.has(pathKey(m.path)));
  if (clash) return { ok: false, error: `A note named ${clash.path} already exists` };
  return { ok: true, moves };
}
