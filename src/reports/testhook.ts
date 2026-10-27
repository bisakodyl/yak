import type * as Y from 'yjs';
import { createRecord, nowIso } from '../core/schema';

/**
 * Seed helper for the browser test, installed as `window.__reports` only when the URL has `?test`.
 * It writes the record shapes of docs/architecture.md; references between records use short names.
 */
export interface SeedData {
  clients?: { ref: string; name: string; archived?: boolean }[];
  projects?: { ref: string; name: string; client?: string; color?: string; rate?: number | null; currency?: string; active?: boolean; billable?: boolean }[];
  entries?: { start: string; stop: string | null; description?: string; project?: string; tags?: string[]; billable?: boolean; deleted?: boolean }[];
}

/** `entriesDoc` is the space's time document; it defaults to `doc`. */
export function seedSpace(doc: Y.Doc, data: SeedData, entriesDoc: Y.Doc = doc): void {
  const now = nowIso();
  const refs = new Map<string, string>();
  for (const c of data.clients ?? []) {
    refs.set(c.ref, createRecord(doc, 'clients', { name: c.name, archived: c.archived ?? false, created_at: now, updated_at: now, deleted: false }));
  }
  for (const p of data.projects ?? []) {
    refs.set(
      p.ref,
      createRecord(doc, 'projects', {
        name: p.name,
        client_id: p.client ? (refs.get(p.client) ?? null) : null,
        color: p.color ?? '#2f6fde',
        billable: p.billable ?? true,
        rate: p.rate ?? null,
        currency: p.currency ?? 'USD',
        active: p.active ?? true,
        created_at: now,
        updated_at: now,
        deleted: false,
      }),
    );
  }
  for (const e of data.entries ?? []) {
    const seconds = e.stop ? Math.round((Date.parse(e.stop) - Date.parse(e.start)) / 1000) : 0;
    createRecord(entriesDoc, 'time_entries', {
      start: e.start,
      stop: e.stop,
      duration: seconds,
      description: e.description ?? '',
      project_id: e.project ? (refs.get(e.project) ?? null) : null,
      task_id: null,
      tags: e.tags ?? [],
      billable: e.billable ?? false,
      device_id: 'test',
      created_at: now,
      updated_at: now,
      deleted: e.deleted ?? false,
    });
  }
}
