import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { emptyState, syncMirror, type MirrorSpace, type MirrorState } from '../../src/mirror/engine';
import { createRecord, collection } from '../../src/core/schema';
import { VaultFs } from './vault-fs';
import { MemoryVault } from './vault-port';
import { analyzeVault, rootProblem, type RuleSpace } from './vault-rules';

const spaces: RuleSpace[] = [
  { id: 'p', name: 'Personal', folder: 'Personal' },
  { id: 'w', name: 'Work', folder: 'Work' },
];

function stateWith(...entries: [string, string][]): MirrorState {
  const state = emptyState();
  for (const [space, path] of entries) {
    (state.spaces[space] ??= {})[`id-${path}`] = { path, text: 't', stamp: '1' };
  }
  return state;
}

describe('vault rules', () => {
  it('is quiet when every space folder is there', () => {
    const v = new MemoryVault();
    v.put('Yak/Personal/A.md', 'a');
    v.put('Yak/Work/B.md', 'b');
    const a = analyzeVault(v, 'Yak', spaces, stateWith(['p', 'A.md'], ['w', 'B.md']));
    expect(a).toEqual({ held: [], renames: [], notices: [] });
  });

  it('notices a note at the root and a folder that is not a space', () => {
    const v = new MemoryVault();
    v.put('Yak/Loose.md', 'x');
    v.put('Yak/Ideas/One.md', 'x');
    const a = analyzeVault(v, 'Yak', spaces, emptyState());
    expect(a.notices).toHaveLength(2);
    expect(a.notices[0]).toContain('Loose.md');
    expect(a.notices[1]).toContain('Yak/Ideas');
    expect(a.held).toEqual([]);
  });

  it('does not notice an archived space folder', () => {
    const v = new MemoryVault();
    v.put('Yak/Old/One.md', 'x');
    expect(analyzeVault(v, 'Yak', spaces, emptyState(), ['Old']).notices).toEqual([]);
  });

  it('names a renamed space folder back', () => {
    const v = new MemoryVault();
    v.put('Yak/Personal/A.md', 'a');
    v.put('Yak/Job/B.md', 'b');
    const a = analyzeVault(v, 'Yak', spaces, stateWith(['p', 'A.md'], ['w', 'B.md']));
    expect(a.renames).toEqual([{ space: spaces[1], from: 'Job' }]);
    expect(a.held).toEqual([]);
    expect(a.notices).toEqual([]);
  });

  it('holds a space whose folder was deleted and asks', () => {
    const v = new MemoryVault();
    v.put('Yak/Personal/A.md', 'a');
    const a = analyzeVault(v, 'Yak', spaces, stateWith(['p', 'A.md'], ['w', 'B.md']));
    expect(a.held).toEqual([spaces[1]]);
  });

  it('does not hold a space that was never written', () => {
    const v = new MemoryVault();
    expect(analyzeVault(v, 'Yak', spaces, emptyState()).held).toEqual([]);
  });

  it('deleting a folder never deletes the notes', async () => {
    const v = new MemoryVault();
    const space: MirrorSpace = { id: 'w', folder: 'Work', doc: new Y.Doc() };
    const now = new Date().toISOString();
    createRecord(space.doc, 'notes', { path: 'B.md', text: new Y.Text('beta'), created_at: now, updated_at: now, deleted: false });
    const fs = new VaultFs(v, 'Yak', () => []);
    const state = emptyState();
    await syncMirror(fs, [space], state);
    v.dropFolder('Yak/Work');
    const a = analyzeVault(v, 'Yak', [spaces[1]!], state);
    expect(a.held).toHaveLength(1);
    // The held space is left out of the pass, so its note stays.
    await syncMirror(fs, [], state);
    const live = [...collection(space.doc, 'notes').values()].filter((r) => r.get('deleted') !== true);
    expect(live).toHaveLength(1);
    // Restoring forgets the state, and the next pass writes the folder again.
    delete state.spaces.w;
    await syncMirror(fs, [space], state);
    expect(v.text('Yak/Work/B.md')).toBe('beta');
  });

  it('checks the root folder name', () => {
    expect(rootProblem('Yak')).toBeUndefined();
    expect(rootProblem('')).toBeDefined();
    expect(rootProblem('a/b')).toBeDefined();
    expect(rootProblem('.hidden')).toBeDefined();
  });
});
