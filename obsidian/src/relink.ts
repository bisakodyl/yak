import type { MirrorState } from '../../src/mirror/engine';
import { toVaultLinks, type LinkSpace } from './links';
import type { VaultPort } from './vault-port';

/**
 * Links are translated when a file is written, so a file written before a space was kept here (or
 * before a note with the same name appeared elsewhere) keeps the old spelling. This rewrites the files
 * that nobody edited since the last pass (same stamp) so their links follow the spaces now kept, and
 * records the new stamp so the engine sees no change. Returns how many files it rewrote.
 */
export async function relinkFiles(vault: VaultPort, root: string, spaces: readonly LinkSpace[], state: MirrorState): Promise<number> {
  const stamps = new Map(vault.files().map((f) => [f.path, `${f.mtime}:${f.size}`]));
  let rewritten = 0;
  for (const space of spaces) {
    for (const entry of Object.values(state.spaces[space.id] ?? {})) {
      if (!entry.text.includes('[[')) continue;
      const path = `${root}/${space.folder}/${entry.path}`;
      if (stamps.get(path) !== entry.stamp) continue;
      const expected = toVaultLinks(entry.text, root, space, spaces);
      if ((await vault.read(path)) === expected) continue;
      const f = await vault.write(path, expected);
      entry.stamp = `${f.mtime}:${f.size}`;
      rewritten++;
    }
  }
  return rewritten;
}

/** A string that changes when the spaces, their folders or their note paths change. */
export function linkSignature(spaces: readonly LinkSpace[]): string {
  return spaces.map((s) => `${s.id}|${s.name}|${s.folder}|${[...s.paths].sort().join('\n')}`).join('\u0001');
}
