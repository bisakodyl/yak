import { describe, expect, it } from 'vitest';
import { allFolders, buildTree, folderOf, folderTarget, moveFolder, normalizePath, noteTitle, pathConflicts, pathProblem, safeName, uniquePath, planMove } from './paths';

describe('paths', () => {
  it('normalizes user input', () => {
    expect(normalizePath(' /Projects//Acme ')).toBe('Projects/Acme.md');
    expect(normalizePath('a\\b\\c.md')).toBe('a/b/c.md');
    expect(normalizePath('../x/./y')).toBe('x/y.md');
    expect(normalizePath('Notes/Readme.MD')).toBe('Notes/Readme.MD');
    expect(normalizePath('  ')).toBe('');
  });

  it('rejects names Obsidian cannot store', () => {
    expect(pathProblem('a/b.md')).toBeNull();
    expect(pathProblem('a:b.md')).toMatch(/cannot contain/);
    expect(pathProblem('.hidden/x.md')).toMatch(/dot/);
    expect(pathProblem('')).toMatch(/name/);
    expect(pathProblem('a\\..\\..\\Other.md')).toMatch(/cannot contain/);
    expect(pathProblem('a\u0000b.md')).toMatch(/control/);
    expect(pathProblem('Work/CON.md')).toMatch(/reserved/);
    expect(pathProblem('nul.txt.md')).toMatch(/reserved/);
    expect(pathProblem('Com1/x.md')).toMatch(/reserved/);
    expect(pathProblem('Console.md')).toBeNull();
    expect(safeName('What? A [test]: 1/2')).toBe('What- A -test-- 1-2');
    expect(safeName('  ')).toBe('Untitled');
    expect(safeName('CON')).toBe('CON-');
    expect(safeName('a\u0001b')).toBe('a-b');
  });

  it('gives titles and folders', () => {
    expect(noteTitle('Projects/Acme.md')).toBe('Acme');
    expect(folderOf('Projects/Sub/Acme.md')).toBe('Projects/Sub');
    expect(folderOf('Acme.md')).toBe('');
  });

  it('finds a free path, ignoring case', () => {
    expect(uniquePath('Untitled.md', [])).toBe('Untitled.md');
    expect(uniquePath('Untitled.md', ['untitled.md', 'Untitled 1.md'])).toBe('Untitled 2.md');
  });

  it('flags two notes with the same path as a conflict', () => {
    const c = pathConflicts([
      { id: '1', path: 'A.md' },
      { id: '2', path: 'a.md' },
      { id: '3', path: 'B.md' },
    ]);
    expect([...c.values()]).toEqual([['1', '2']]);
  });

  it('builds a sorted folder tree with implied folders', () => {
    const tree = buildTree([
      { id: '1', path: 'Zeta.md' },
      { id: '2', path: 'Projects/Acme.md' },
      { id: '3', path: 'projects/Beta.md' },
      { id: '4', path: 'Projects/Sub/Note 10.md' },
      { id: '5', path: 'Projects/Sub/Note 9.md' },
      { id: '6', path: 'Alpha.md' },
    ]);
    expect(tree.notes.map((n) => n.id)).toEqual(['6', '1']);
    expect(tree.folders.map((f) => f.path)).toEqual(['Projects']);
    const projects = tree.folders[0]!;
    expect(projects.notes.map((n) => n.id)).toEqual(['2', '3']);
    expect(projects.folders[0]!.notes.map((n) => n.id)).toEqual(['5', '4']);
    expect(allFolders([{ id: '1', path: 'a/b/c.md' }, { id: '2', path: 'A/d.md' }])).toEqual(['a', 'a/b']);
  });

  it('moves a folder by changing the paths under it only', () => {
    const items = [
      { id: '1', path: 'Projects/Acme.md' },
      { id: '2', path: 'Projects/Sub/X.md' },
      { id: '3', path: 'ProjectsOld/Y.md' },
    ];
    expect(moveFolder(items, 'Projects', 'Archive/2026')).toEqual([
      { id: '1', path: 'Archive/2026/Acme.md' },
      { id: '2', path: 'Archive/2026/Sub/X.md' },
    ]);
    expect(moveFolder(items, 'Projects', '')).toEqual([
      { id: '1', path: 'Acme.md' },
      { id: '2', path: 'Sub/X.md' },
    ]);
  });
});

describe('planMove', () => {
  const items = [
    { id: 'a', path: 'Projects/Acme.md' },
    { id: 'b', path: 'Projects/Sub/Plan.md' },
    { id: 'c', path: 'Ideas.md' },
    { id: 'd', path: 'Archive/Ideas.md' },
  ];
  it('moves a note into a folder and to the top level', () => {
    expect(planMove(items, { kind: 'note', id: 'a' }, 'Archive')).toEqual({ ok: true, moves: [{ id: 'a', path: 'Archive/Acme.md' }] });
    expect(planMove(items, { kind: 'note', id: 'b' }, '')).toEqual({ ok: true, moves: [{ id: 'b', path: 'Plan.md' }] });
  });
  it('does nothing when dropped where it is', () => {
    expect(planMove(items, { kind: 'note', id: 'a' }, 'projects')).toEqual({ ok: true, moves: [] });
    expect(planMove(items, { kind: 'folder', path: 'Projects/Sub' }, 'Projects')).toEqual({ ok: true, moves: [] });
  });
  it('moves a folder with everything in it', () => {
    expect(planMove(items, { kind: 'folder', path: 'Projects' }, 'Archive')).toEqual({
      ok: true,
      moves: [
        { id: 'a', path: 'Archive/Projects/Acme.md' },
        { id: 'b', path: 'Archive/Projects/Sub/Plan.md' },
      ],
    });
  });
  it('refuses a folder into itself or its own subfolder', () => {
    expect(planMove(items, { kind: 'folder', path: 'Projects' }, 'Projects/Sub')).toEqual({ ok: false, error: 'A folder cannot be moved into itself' });
  });
  it('refuses a move onto an existing note', () => {
    expect(planMove(items, { kind: 'note', id: 'c' }, 'Archive')).toEqual({ ok: false, error: 'A note named Archive/Ideas.md already exists' });
  });
  it('refuses bad folder names', () => {
    expect(planMove(items, { kind: 'note', id: 'c' }, 'Bad:Name').ok).toBe(false);
  });
});

describe('folders kept without notes', () => {
  const notes = [{ id: 'n1', path: 'Projects/Acme.md' }];

  it('shows an empty folder, nested ones with their parents', () => {
    const tree = buildTree(notes, ['Ideas', 'Projects/Archive/2025']);
    expect(tree.folders.map((f) => f.name)).toEqual(['Ideas', 'Projects']);
    const projects = tree.folders.find((f) => f.name === 'Projects');
    expect(projects?.folders.map((f) => f.name)).toEqual(['Archive']);
    expect(projects?.folders[0]?.folders.map((f) => f.path)).toEqual(['Projects/Archive/2025']);
    expect(projects?.notes.map((n) => n.id)).toEqual(['n1']);
  });

  it('does not duplicate a folder that also has notes, whatever the case', () => {
    expect(buildTree(notes, ['projects']).folders.map((f) => f.name)).toEqual(['Projects']);
  });

  it('lists empty folders and their parents among all folders', () => {
    expect(allFolders(notes, ['Ideas/Later'])).toEqual(['Ideas', 'Ideas/Later', 'Projects']);
  });

  it('says where a folder lands when moved', () => {
    expect(folderTarget('Projects/Archive', '')).toBe('Archive');
    expect(folderTarget('Archive', 'Projects')).toBe('Projects/Archive');
    expect(folderTarget('A/B', '/C/')).toBe('C/B');
  });
});

