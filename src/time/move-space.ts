import type { BulkTx } from '../core/bulk';
import { moveTag } from '../core/move-tag';
import { readRate, writeRate } from '../core/rates';
import { collection } from '../core/schema';
import { moveToSpace, type Spaces, type Target } from './bulk-edit';
import { createClient, createProject, liveClients, liveProjects, updateClient, updateProject } from './catalog';

/**
 * Moving a project or client to another space (owner, 2026-10-19): the source is archived and the
 * destination gets a new one; nothing is deleted. Entries follow their project by default.
 */
export interface MoveOptions {
  /** Move the project's live entries too (default). */
  entries: boolean;
  /** A project that already has this name in the destination: use it (`merge`) or create under `name`. */
  clash?: { kind: 'merge' } | { kind: 'rename'; name: string };
}

export interface MoveResult {
  projects: number;
  clients: number;
  entries: number;
  /** Entries left where they were (running timers). */
  skipped: number;
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The destination's project with this name, if any. */
export function projectClash(spaces: Spaces, toSpace: string, name: string) {
  const dest = spaces.get(toSpace);
  return dest ? liveProjects(dest.doc).find((p) => same(p.name, name)) : undefined;
}

export function clientClash(spaces: Spaces, toSpace: string, name: string) {
  const dest = spaces.get(toSpace);
  return dest ? liveClients(dest.doc).find((c) => same(c.name, name)) : undefined;
}

/** Live, non-running entries of a project in its space. */
export function projectEntryTargets(spaces: Spaces, spaceId: string, projectId: string): Target[] {
  const h = spaces.get(spaceId);
  if (!h) return [];
  const out: Target[] = [];
  collection(h.privateDoc, 'time_entries').forEach((rec, id) => {
    if (rec.get('deleted') !== true && rec.get('project_id') === projectId) out.push({ spaceId, id });
  });
  return out;
}

function clientIn(spaces: Spaces, from: string, to: string, clientId: string | null): string | null {
  const src = clientId ? liveClients(spaces.get(from)!.doc).find((c) => c.id === clientId) : undefined;
  if (!src) return null;
  const dest = spaces.get(to)!;
  return clientClash(spaces, to, src.name)?.id ?? createClient(dest.doc, src.name);
}

/** Move one project: archive it here, create it there with its client and private rate, move its entries. */
export function moveProject(spaces: Spaces, from: string, projectId: string, to: string, deviceId: string, options: MoveOptions, tx: BulkTx): MoveResult {
  const out: MoveResult = { projects: 0, clients: 0, entries: 0, skipped: 0 };
  const src = spaces.get(from);
  const dest = spaces.get(to);
  const project = src && liveProjects(src.doc, src.privateDoc).find((p) => p.id === projectId);
  if (!src || !dest || !project || from === to) return out;
  const existing = projectClash(spaces, to, project.name);
  let destId: string | null = null;
  const merging = existing !== undefined && options.clash?.kind !== 'rename';
  if (merging) destId = existing.id;
  else {
    const name = options.clash?.kind === 'rename' ? options.clash.name : project.name;
    tx(dest.doc, () => {
      const before = liveClients(dest.doc).length;
      const clientId = clientIn(spaces, from, to, project.client_id);
      out.clients = liveClients(dest.doc).length - before;
      destId = createProject(dest.doc, { name, client_id: clientId, color: project.color, billable: project.billable });
    });
    const rate = readRate(src.privateDoc, projectId);
    if (destId && rate) {
      const id = destId;
      tx(dest.privateDoc, () => writeRate(dest.privateDoc, id, rate));
    }
    if (destId) out.projects = 1;
  }
  tx(src.doc, () => void updateProject(src.doc, projectId, { active: false }));
  if (options.entries && destId) {
    const r = moveToSpace(spaces, projectEntryTargets(spaces, from, projectId), to, deviceId, tx, new Map([[projectId, destId]]));
    out.entries = r.changed;
    out.skipped = r.skipped;
  }
  return out;
}

/** Move a client: archive it here, create it there (or reuse the same name); optionally its projects with their entries. */
export function moveClient(spaces: Spaces, from: string, clientId: string, to: string, deviceId: string, options: { projects: boolean; entries: boolean }, tx: BulkTx): MoveResult {
  const out: MoveResult = { projects: 0, clients: 0, entries: 0, skipped: 0 };
  const src = spaces.get(from);
  const dest = spaces.get(to);
  const client = src && liveClients(src.doc).find((c) => c.id === clientId);
  if (!src || !dest || !client || from === to) return out;
  if (!clientClash(spaces, to, client.name)) {
    tx(dest.doc, () => void createClient(dest.doc, client.name));
    out.clients = 1;
  }
  if (options.projects) {
    for (const p of liveProjects(src.doc).filter((x) => x.client_id === clientId && x.active)) {
      const r = moveProject(spaces, from, p.id, to, deviceId, { entries: options.entries }, tx);
      out.projects += r.projects;
      out.entries += r.entries;
      out.skipped += r.skipped;
    }
  }
  tx(src.doc, () => void updateClient(src.doc, clientId, { archived: true }));
  return out;
}

/** What a bulk move takes: the selected items, each in its own space. */
export interface MoveSelection {
  projects: { spaceId: string; id: string }[];
  clients: { spaceId: string; id: string }[];
  /** Tags by name; moved out of each of these spaces except the destination. */
  tags: { name: string; spaceIds: string[] }[];
}

export interface MoveManyResult extends MoveResult {
  tags: number;
  /** Selected items already in the destination space. */
  inDestination: number;
}

/**
 * Move several projects, clients and tags to one space (bulk selection on Organize). Each item
 * moves as it does alone; a name that exists in the destination is merged into. Clients go first, with
 * their projects when `projects` is on, so a project selected as well is not moved twice. Items already
 * in the destination are left and counted.
 */
export function moveMany(spaces: Spaces, sel: MoveSelection, to: string, deviceId: string, options: { entries: boolean; projects: boolean }, tx: BulkTx): MoveManyResult {
  const out: MoveManyResult = { projects: 0, clients: 0, entries: 0, skipped: 0, tags: 0, inDestination: 0 };
  const add = (r: MoveResult): void => {
    out.projects += r.projects;
    out.clients += r.clients;
    out.entries += r.entries;
    out.skipped += r.skipped;
  };
  for (const c of sel.clients) {
    if (c.spaceId === to) out.inDestination++;
    else add(moveClient(spaces, c.spaceId, c.id, to, deviceId, options, tx));
  }
  for (const p of sel.projects) {
    if (p.spaceId === to) {
      out.inDestination++;
      continue;
    }
    const src = spaces.get(p.spaceId);
    // A client's move above may have taken it already.
    if (!src || !liveProjects(src.doc).find((x) => x.id === p.id)?.active) continue;
    add(moveProject(spaces, p.spaceId, p.id, to, deviceId, { entries: options.entries }, tx));
  }
  const dest = spaces.get(to);
  for (const t of sel.tags) {
    for (const id of t.spaceIds) {
      const src = spaces.get(id);
      if (id === to) out.inDestination++;
      else if (src && dest) {
        moveTag(src.doc, dest.doc, t.name, undefined, tx);
        out.tags++;
      }
    }
  }
  return out;
}
