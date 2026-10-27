import type { MirrorState } from '../../src/mirror/engine';
import type { VaultPort } from './vault-port';

/**
 * The vault rules (#64), applied before each mirror pass:
 * - Notes in a space's folder sync to that space.
 * - A note at the root, or a new folder directly under it, is not synced: a notice says so.
 * - A space's folder renamed: not a space rename; the folder is named back.
 * - A space's folder deleted: notes are never deleted for it; the space is held and the owner is
 *   asked to restore the folder or stop keeping the space here.
 */

export interface RuleSpace {
  id: string;
  name: string;
  folder: string;
}

export interface VaultAnalysis {
  /** Spaces left out of this pass: their folder is gone and the owner has not decided. */
  held: RuleSpace[];
  /** Folders to name back (the space's folder was renamed in the vault). */
  renames: { space: RuleSpace; from: string }[];
  /** Notices for what is not synced, one line each. */
  notices: string[];
}

const lower = (s: string): string => s.toLowerCase();

export function analyzeVault(vault: VaultPort, root: string, spaces: readonly RuleSpace[], state: MirrorState, quiet: readonly string[] = []): VaultAnalysis {
  const prefix = `${root}/`;
  const files = vault.files().filter((f) => f.path.startsWith(prefix));
  const topFolders = new Map<string, string>();
  for (const f of files) {
    const rest = f.path.slice(prefix.length);
    const slash = rest.indexOf('/');
    if (slash > 0) topFolders.set(lower(rest.slice(0, slash)), rest.slice(0, slash));
  }
  for (const d of vault.folders()) {
    if (!d.startsWith(prefix)) continue;
    const rest = d.slice(prefix.length);
    const name = rest.split('/')[0]!;
    if (name) topFolders.set(lower(name), name);
  }
  // `quiet` names folders of spaces that are kept but not mirrored (archived), so they get no notice.
  const known = new Set([...spaces.map((s) => lower(s.folder)), ...quiet.map(lower)]);
  const strays = [...topFolders].filter(([key]) => !known.has(key)).map(([, name]) => name);

  const notices: string[] = [];
  for (const f of files) {
    const rest = f.path.slice(prefix.length);
    if (!rest.includes('/') && /\.md$/i.test(rest)) {
      notices.push(`"${rest}" is at the root of ${root}/ and is not synced. Create the space in Yak, or move the note into a space folder.`);
    }
  }

  const held: RuleSpace[] = [];
  const renames: VaultAnalysis['renames'] = [];
  const claimed = new Set<string>();
  for (const space of spaces) {
    if (topFolders.has(lower(space.folder))) continue;
    const entries = Object.values(state.spaces[space.id] ?? {});
    // Nothing was ever written for this space: the folder is simply not made yet.
    if (entries.length === 0) continue;
    const candidates = strays.filter((name) => {
      if (claimed.has(name)) return false;
      const own = new Set(files.filter((f) => lower(f.path).startsWith(`${lower(prefix + name)}/`)).map((f) => lower(f.path.slice(prefix.length + name.length + 1))));
      return entries.some((e) => own.has(lower(e.path)));
    });
    if (candidates.length === 1) {
      claimed.add(candidates[0]!);
      renames.push({ space, from: candidates[0]! });
    } else {
      held.push(space);
    }
  }
  for (const name of strays) {
    if (claimed.has(name)) continue;
    notices.push(`The folder "${root}/${name}" is not a space and is not synced. Create the space in Yak, or move its notes into a space folder.`);
  }
  return { held, renames, notices };
}

/** A root folder name the vault can hold: one segment, not hidden. */
export function rootProblem(root: string): string | undefined {
  if (!root.trim()) return 'Enter a folder name.';
  if (/[\\/:*?"<>|]/.test(root)) return 'Use one folder name, without slashes or special characters.';
  if (root.startsWith('.')) return 'A folder starting with a dot is hidden from Obsidian.';
  return undefined;
}
