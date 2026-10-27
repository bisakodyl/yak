import * as Y from 'yjs';
import { DocumentStore } from '../core/doc-store';
import { createRecord, initSpaceDoc, softDelete } from '../core/schema';

/** Helpers shared by the backup tests and the `?test` browser hook. No personal data. */

const memoryPersist = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });

export function memoryStore(): DocumentStore {
  return new DocumentStore(memoryPersist);
}

const iso = (s: string): string => new Date(s).toISOString();

export function addNote(doc: Y.Doc, path: string, markdown: string): string {
  const text = new Y.Text();
  text.insert(0, markdown);
  return createRecord(doc, 'notes', { path, text, created_at: iso('2026-09-01T08:00:00Z'), updated_at: iso('2026-09-01T08:00:00Z'), deleted: false });
}

export function addEntry(doc: Y.Doc, start: string, stop: string | null, description: string, extra: Record<string, unknown> = {}): string {
  const duration = stop ? Math.round((Date.parse(stop) - Date.parse(start)) / 1000) : 0;
  return createRecord(doc, 'time_entries', {
    start: iso(start),
    stop: stop ? iso(stop) : null,
    duration,
    description,
    project_id: null,
    task_id: null,
    tags: [],
    billable: false,
    device_id: 'test-device',
    created_at: iso(start),
    updated_at: iso(start),
    deleted: false,
    ...extra,
  });
}

/**
 * Fill a space document with sample data of every kind: entries over three months (one running,
 * one soft-deleted), projects, a client, tags, notes (one soft-deleted, two sharing a path),
 * settings, and a raw text root.
 */
/** `entriesDoc` is the space's time document; it defaults to `doc` (the first layout, unit tests). */
export function seedSpace(doc: Y.Doc, label: string, entriesDoc: Y.Doc = doc): Record<string, string> {
  initSpaceDoc(doc);
  const client = createRecord(doc, 'clients', { name: `${label} client`, archived: false, created_at: iso('2026-08-01T00:00:00Z'), updated_at: iso('2026-08-01T00:00:00Z'), deleted: false });
  const project = createRecord(doc, 'projects', {
    name: `${label} project`,
    client_id: client,
    color: '#2f6fde',
    billable: true,
    rate: 100,
    currency: 'USD',
    active: true,
    created_at: iso('2026-08-01T00:00:00Z'),
    updated_at: iso('2026-08-01T00:00:00Z'),
    deleted: false,
  });
  const oldProject = createRecord(doc, 'projects', { name: 'Old', client_id: null, color: '#000000', billable: false, rate: null, currency: 'USD', active: false, created_at: iso('2026-07-01T00:00:00Z'), updated_at: iso('2026-07-01T00:00:00Z'), deleted: false });
  softDelete(doc, 'projects', oldProject);
  const tag = createRecord(doc, 'tags', { name: 'deep-work', created_at: iso('2026-08-01T00:00:00Z'), deleted: false });
  const e1 = addEntry(entriesDoc, '2026-08-31T22:00:00Z', '2026-08-31T23:30:00Z', `${label} late August`, { project_id: project, tags: ['deep-work'], billable: true });
  const e2 = addEntry(entriesDoc, '2026-09-10T09:00:00Z', '2026-09-10T10:15:00Z', `${label} September`);
  const e3 = addEntry(entriesDoc, '2026-10-01T09:00:00Z', '2026-10-01T09:45:00Z', `${label} deleted entry`);
  softDelete(entriesDoc, 'time_entries', e3);
  const running = addEntry(entriesDoc, '2026-10-15T08:00:00Z', null, `${label} running`);
  const note = addNote(doc, 'Projects/Acme.md', `---\ntags: [task]\nstatus: open\n---\n# ${label} note\n\nSome *Markdown* text.\n`);
  const twin = addNote(doc, 'projects/ACME.md', 'Same path, other case.\n');
  const gone = addNote(doc, 'Trash/Old.md', 'Deleted note body.\n');
  softDelete(doc, 'notes', gone);
  doc.getMap('settings').set('week_start', 'monday');
  doc.getText('t').insert(0, `${label} raw text root`);
  return { client, project, oldProject, tag, e1, e2, e3, running, note, twin, gone };
}

/** JSON of every root type of `reference`, read from `doc` with the same Yjs type. */
export function docJSON(doc: Y.Doc, reference: Y.Doc = doc): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, type] of [...reference.share].sort(([a], [b]) => a.localeCompare(b))) {
    if (type instanceof Y.Text) out[name] = doc.getText(name).toJSON();
    else if (type instanceof Y.Array) out[name] = doc.getArray(name).toJSON();
    else out[name] = doc.getMap(name).toJSON();
  }
  return out;
}

export function stateVector(doc: Y.Doc): Map<number, number> {
  return Y.decodeStateVector(Y.encodeStateVector(doc));
}
