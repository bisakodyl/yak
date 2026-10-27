import { describe, expect, it } from 'vitest';
import { bulkEdit } from '../core/bulk';
import { hiddenTags } from '../core/hidden-tags';
import { moveTag } from '../core/move-tag';
import { readRate } from '../core/rates';
import { createClient, createProject, liveClients, liveProjects, uniqueTagNames, updateProject } from './catalog';
import { addManualEntry, liveEntries } from './entries';
import type { Spaces } from './bulk-edit';
import { moveClient, moveMany, moveProject } from './move-space';
import { at, makeSpaceDocs } from './testing';

function setup() {
  const docs = makeSpaceDocs();
  const spaces: Spaces = new Map([...docs].map(([id, d]) => [id, { doc: d, privateDoc: d }]));
  const p = docs.get('personal')!;
  const w = docs.get('work')!;
  const client = createClient(p, 'Acme')!;
  const project = createProject(p, { name: 'Site', client_id: client, color: '#112233', billable: true })!;
  updateProject(p, project, { rate: 50, currency: 'EUR' }, p);
  for (const day of [1, 2]) addManualEntry(p, 'dev', { start: at(2026, 10, day, 9), stop: at(2026, 10, day, 10), description: `e${day}`, project_id: project });
  const run = <T>(fn: Parameters<typeof bulkEdit<T>>[1]) => bulkEdit([p, w], fn);
  return { spaces, p, w, client, project, run };
}

describe('move a project to another space', () => {
  it('archives it, creates it with client and rate, and moves its entries; Undo restores all', () => {
    const { spaces, p, w, project, run } = setup();
    const { result, undo } = run((tx) => moveProject(spaces, 'personal', project, 'work', 'dev', { entries: true }, tx));
    expect(result).toMatchObject({ projects: 1, clients: 1, entries: 2 });
    expect(liveProjects(p).find((x) => x.id === project)!.active).toBe(false);
    const made = liveProjects(w)[0]!;
    expect([made.name, made.color, made.billable]).toEqual(['Site', '#112233', true]);
    expect(liveClients(w).map((c) => c.name)).toEqual(['Acme']);
    expect(readRate(w, made.id)).toEqual({ rate: 50, currency: 'EUR' });
    expect(liveEntries(w).filter((e) => e.project_id === made.id)).toHaveLength(2);
    expect(liveEntries(p)).toHaveLength(0);
    undo();
    expect(liveProjects(p)[0]!.active).toBe(true);
    expect(liveProjects(w)).toHaveLength(0);
    expect(liveEntries(p)).toHaveLength(2);
    expect(liveEntries(w)).toHaveLength(0);
  });

  it('leaves the entries when asked', () => {
    const { spaces, p, w, project, run } = setup();
    const { result } = run((tx) => moveProject(spaces, 'personal', project, 'work', 'dev', { entries: false }, tx));
    expect(result.entries).toBe(0);
    expect(liveEntries(p)).toHaveLength(2);
    expect(liveEntries(w)).toHaveLength(0);
    expect(liveProjects(w)).toHaveLength(1);
  });

  it('merges into a project of the same name, or creates under a new name', () => {
    const { spaces, w, project, run } = setup();
    const existing = createProject(w, { name: 'site' })!;
    run((tx) => moveProject(spaces, 'personal', project, 'work', 'dev', { entries: true, clash: { kind: 'merge' } }, tx));
    expect(liveProjects(w)).toHaveLength(1);
    expect(liveEntries(w).every((e) => e.project_id === existing)).toBe(true);
    const again = setup();
    createProject(again.w, { name: 'Site' });
    again.run((tx) => moveProject(again.spaces, 'personal', again.project, 'work', 'dev', { entries: true, clash: { kind: 'rename', name: 'Site 2' } }, tx));
    const renamed = liveProjects(again.w).find((x) => x.name === 'Site 2')!;
    expect(liveEntries(again.w).every((e) => e.project_id === renamed.id)).toBe(true);
  });

  it('moves a client with its projects, or alone', () => {
    const a = setup();
    const r = a.run((tx) => moveClient(a.spaces, 'personal', a.client, 'work', 'dev', { projects: true, entries: true }, tx)).result;
    expect(r).toMatchObject({ projects: 1, entries: 2 });
    expect(liveClients(a.p)[0]!.archived).toBe(true);
    expect(liveClients(a.w)).toHaveLength(1);
    const b = setup();
    b.run((tx) => moveClient(b.spaces, 'personal', b.client, 'work', 'dev', { projects: false, entries: true }, tx));
    expect(liveProjects(b.w)).toHaveLength(0);
    expect(liveClients(b.w)).toHaveLength(1);
  });
});

describe('move a tag to another space', () => {
  it('hides it in the source and creates it in the destination', () => {
    const { p, w } = setup();
    expect(moveTag(p, w, 'Urgent')).toBe('Urgent');
    expect(hiddenTags(p).has('urgent')).toBe(true);
    expect(uniqueTagNames(w)).toEqual(['Urgent']);
    moveTag(p, w, 'Urgent');
    expect(uniqueTagNames(w)).toEqual(['Urgent']);
    expect(moveTag(p, w, 'Urgent', 'Urgent 2')).toBe('Urgent 2');
  });
});

describe('move a tag with one Undo', () => {
  it('undoes the hide and the creation', () => {
    const { p, w } = setup();
    const { undo } = bulkEdit([p, w], (tx) => moveTag(p, w, 'Urgent', undefined, tx));
    expect(uniqueTagNames(w)).toEqual(['Urgent']);
    undo();
    expect(uniqueTagNames(w)).toEqual([]);
    expect(hiddenTags(p).size).toBe(0);
  });
});

describe('move several items at once', () => {
  it('moves projects, clients and tags in one go; one Undo; no project twice', () => {
    const { spaces, p, w, client, project, run } = setup();
    const other = createProject(p, { name: 'Other' })!;
    const sel = {
      clients: [{ spaceId: 'personal', id: client }],
      projects: [{ spaceId: 'personal', id: project }, { spaceId: 'personal', id: other }],
      tags: [{ name: 'Deep', spaceIds: ['personal'] }],
    };
    const { result, undo } = run((tx) => moveMany(spaces, sel, 'work', 'dev', { entries: true, projects: true }, tx));
    expect(result).toMatchObject({ projects: 2, clients: 1, entries: 2, tags: 1, inDestination: 0 });
    expect(liveProjects(w).map((x) => x.name).sort()).toEqual(['Other', 'Site']);
    expect(liveProjects(p).every((x) => !x.active)).toBe(true);
    expect(hiddenTags(p).has('deep')).toBe(true);
    expect(liveEntries(w)).toHaveLength(2);
    undo();
    expect(liveProjects(w)).toHaveLength(0);
    expect(liveProjects(p).every((x) => x.active)).toBe(true);
    expect(hiddenTags(p).size).toBe(0);
    expect(liveEntries(p)).toHaveLength(2);
  });

  it('leaves entries when asked, merges names, and counts items already there', () => {
    const { spaces, w, project, run } = setup();
    const existing = createProject(w, { name: 'Site' })!;
    const inWork = createProject(w, { name: 'Here' })!;
    const sel = { clients: [], projects: [{ spaceId: 'personal', id: project }, { spaceId: 'work', id: inWork }], tags: [{ name: 'x', spaceIds: ['work'] }] };
    const { result } = run((tx) => moveMany(spaces, sel, 'work', 'dev', { entries: false, projects: false }, tx));
    expect(result).toMatchObject({ projects: 0, entries: 0, tags: 0, inDestination: 2 });
    expect(liveProjects(w).map((x) => x.id).sort()).toEqual([existing, inWork].sort());
  });
});
