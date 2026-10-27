import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, createRecord, initSpaceDoc, liveRecords, type Project, type TimeEntry } from '../core/schema';
import { importId } from './fingerprint';
import { buildPlan, parseTogglFile, readExisting } from './plan';
import { runImport } from './run';

const SAMPLE = readFileSync(new URL('./fixtures/toggl-sample.csv', import.meta.url), 'utf8');
const HEADER = 'Client,Project,Description,Billable,Start date,Start time,End date,End time,Duration,Tags';

const newDoc = (): Y.Doc => {
  const d = new Y.Doc();
  initSpaceDoc(d);
  return d;
};
const plan = (csv: string, doc: Y.Doc, zone = 'UTC') => buildPlan(parseTogglFile(csv), readExisting(doc), { zone });
const entriesOf = (doc: Y.Doc) => liveRecords<TimeEntry>(doc, 'time_entries');
const csvOf = (...lines: string[]): string => [HEADER, ...lines].join('\n') + '\n';

describe('parseTogglFile', () => {
  it('reads the sample export', () => {
    const f = parseTogglFile(SAMPLE);
    expect(f.fileProblems).toEqual([]);
    expect(f.rows).toHaveLength(11);
    expect(f.ignoredColumns).toContain('Amount (EUR)');
  });

  it('refuses an empty file and a file that is not a Toggl export', () => {
    expect(parseTogglFile('').fileProblems).toEqual(['The file is empty.']);
    const other = parseTogglFile('Name,Age\nAnn,3\n');
    expect(other.fileProblems[0]).toMatch(/None of the column headings/);
  });

  it('tolerates a header only', () => {
    expect(parseTogglFile(HEADER + '\n').rows).toEqual([]);
  });
});

describe('buildPlan on the sample export', () => {
  it('counts what would be imported, in Berlin time', async () => {
    const p = await plan(SAMPLE, newDoc(), 'Europe/Berlin');
    expect(p.fileProblems).toEqual([]);
    expect(p.entries).toHaveLength(9);
    expect(p.duplicatesInFile).toBe(1);
    expect(p.duplicatesExisting).toBe(0);
    expect(p.errorCount).toBe(1);
    expect(p.errors[0]).toMatchObject({ message: expect.stringContaining('2025-02-31') });
    expect(p.newClients).toBe(2);
    expect(p.newProjects).toBe(3);
    expect([...p.newTags].sort()).toEqual(['admin', 'design', 'meeting', 'review']);
    expect(p.totalSeconds / 3600).toBe(36.75);
    expect([p.firstDay, p.lastDay]).toEqual(['2025-03-10', '2025-03-30']);
  });

  it('keeps entry order, billable flags and tag names', async () => {
    const p = await plan(SAMPLE, newDoc(), 'Europe/Berlin');
    expect(p.entries.map((e) => e.description)).toEqual([
      'Homepage layout',
      'Meeting, with "quotes"',
      'Notes on\ntwo lines',
      'Invoices',
      'Reading',
      'Late deploy',
      'Long running job',
      'Night shift',
      'Review call',
    ]);
    expect(p.entries[0]).toMatchObject({ billable: true, tags: ['design', 'review'], start: '2025-03-10T08:00:00.000Z', stop: '2025-03-10T10:30:00.000Z', duration: 9000 });
    expect(p.entries[3]).toMatchObject({ billable: false });
    expect(p.entries[4]).toMatchObject({ projectKey: null });
  });

  it('gets the awkward rows right', async () => {
    const p = await plan(SAMPLE, newDoc(), 'Europe/Berlin');
    const by = (d: string) => p.entries.find((e) => e.description === d)!;
    expect(by('Late deploy').duration).toBe(9000);
    expect(by('Late deploy').start).toBe('2025-03-13T22:00:00.000Z');
    expect(by('Long running job').duration).toBe(26 * 3600);
    expect(by('Night shift').duration).toBe(3600);
    expect(by('Night shift').start).toBe('2025-03-30T00:30:00.000Z');
    expect(p.warnings.filter((w) => /different people|Duration/.test(w))).toEqual([]);
  });

  it('warns about a wrong time zone through the Duration column', async () => {
    // In UTC the Night shift row (01:30 to 03:30) is two hours but Toggl says one.
    const p = await plan(SAMPLE, newDoc(), 'UTC');
    expect(p.warnings.some((w) => /1 row where the start and end do not match the Duration/.test(w))).toBe(true);
  });
});

describe('importing into a document', () => {
  it('creates records with the documented shape', async () => {
    const doc = newDoc();
    const p = await plan(SAMPLE, doc, 'Europe/Berlin');
    const now = new Date('2025-06-01T12:00:00Z');
    const r = await runImport(doc, p, { deviceId: 'dev-1', now });
    expect(r).toMatchObject({ created: 9, total: 9, cancelled: false, createdClients: 2, createdProjects: 3, createdTags: 4 });
    const entries = entriesOf(doc);
    expect(entries).toHaveLength(9);
    for (const e of entries) {
      expect(e.stop).not.toBeNull();
      expect(e.device_id).toBe('dev-1');
      expect(e.created_at).toBe(now.toISOString());
      expect(e.updated_at).toBe(now.toISOString());
      expect(e.deleted).toBe(false);
      expect(e.task_id).toBeNull();
      expect(e.import_id).toMatch(/^toggl-csv:v1:[0-9a-f]{32}$/);
      expect(e.duration).toBe(Math.round((Date.parse(e.stop!) - Date.parse(e.start)) / 1000));
    }
    expect(liveRecords(doc, 'clients')).toHaveLength(2);
    expect(liveRecords(doc, 'projects')).toHaveLength(3);
    expect(liveRecords(doc, 'tags').map((t) => (t as unknown as { name: string }).name).sort()).toEqual(['admin', 'design', 'meeting', 'review']);
    // Same project name under two clients stays two projects.
    const names = liveRecords<Project>(doc, 'projects').filter((p) => p.name === 'Website Redesign');
    expect(names).toHaveLength(2);
    expect(new Set(names.map((p) => p.client_id)).size).toBe(2);
    const clients = new Map(liveRecords<{ name: string }>(doc, 'clients').map((c) => [c.id, c.name]));
    expect(names.map((p) => clients.get(p.client_id!)).sort()).toEqual(['Example Client', 'Other Client']);
    const internal = liveRecords<Project>(doc, 'projects').find((p) => p.name === 'Internal Admin')!;
    expect(internal).toMatchObject({ client_id: null, rate: null, billable: false, active: true });
    expect(internal.color).toMatch(/^#[0-9a-f]{6}$/);
    // Entries point at the right projects.
    const deploy = entries.find((e) => e.description === 'Late deploy')!;
    expect(deploy.project_id).toBe(internal.id);
    expect(entries.find((e) => e.description === 'Reading')!.project_id).toBeNull();
  });

  it('is idempotent: importing the same file twice adds nothing', async () => {
    const doc = newDoc();
    await runImport(doc, await plan(SAMPLE, doc, 'Europe/Berlin'), { deviceId: 'd' });
    const before = Y.encodeStateAsUpdate(doc).length;
    const again = await plan(SAMPLE, doc, 'Europe/Berlin');
    expect(again.entries).toHaveLength(0);
    expect(again.duplicatesExisting).toBe(9);
    expect(again.duplicatesInFile).toBe(1);
    expect(again.newProjects + again.newClients + again.newTags.length).toBe(0);
    const r = await runImport(doc, again, { deviceId: 'd' });
    expect(r.created).toBe(0);
    expect(entriesOf(doc)).toHaveLength(9);
    expect(liveRecords(doc, 'projects')).toHaveLength(3);
    expect(Y.encodeStateAsUpdate(doc).length).toBe(before);
  });

  it('is idempotent when the same file is imported twice before re-reading the document', async () => {
    const doc = newDoc();
    const p = await plan(SAMPLE, doc, 'Europe/Berlin');
    await runImport(doc, p, { deviceId: 'd' });
    const second = await plan(SAMPLE, doc, 'Europe/Berlin');
    await runImport(doc, second, { deviceId: 'd' });
    expect(entriesOf(doc)).toHaveLength(9);
  });

  it('adds only the new rows of an overlapping export', async () => {
    const doc = newDoc();
    const a = csvOf('C,P,one,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,t', 'C,P,two,Yes,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,t');
    const b = csvOf('C,P,two,Yes,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,t', 'C,P,three,Yes,2025-01-03,09:00:00,2025-01-03,10:00:00,1:00:00,t');
    await runImport(doc, await plan(a, doc), { deviceId: 'd' });
    const p = await plan(b, doc);
    expect(p.entries.map((e) => e.description)).toEqual(['three']);
    expect(p.duplicatesExisting).toBe(1);
    expect(p.newProjects).toBe(0);
    await runImport(doc, p, { deviceId: 'd' });
    expect(entriesOf(doc).map((e) => e.description).sort()).toEqual(['one', 'three', 'two']);
  });

  it('skips duplicates within one file and counts them', async () => {
    const line = 'C,P,same,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,';
    const p = await plan(csvOf(line, line, line), newDoc());
    expect(p.entries).toHaveLength(1);
    expect(p.duplicatesInFile).toBe(2);
  });

  it('treats a different time, description, project or client as a different entry', async () => {
    const rows = [
      'C,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,',
      'C,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:01,1:00:01,',
      'C,P,y,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,',
      'C,Q,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,',
      'D,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,',
    ];
    expect((await plan(csvOf(...rows), newDoc())).entries).toHaveLength(5);
  });

  it('ignores case and surrounding spaces in project and client names for the fingerprint', async () => {
    const p = await plan(csvOf('c,p,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,', ' C , P ,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,'), newDoc());
    expect(p.entries).toHaveLength(1);
    expect(p.duplicatesInFile).toBe(1);
  });

  it('still skips an entry after it was edited or its tags changed', async () => {
    const doc = newDoc();
    const csv = csvOf('C,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,a');
    await runImport(doc, await plan(csv, doc), { deviceId: 'd' });
    const [e] = entriesOf(doc);
    collection(doc, 'time_entries').get(e!.id)!.set('tags', []);
    collection(doc, 'time_entries').get(e!.id)!.set('billable', false);
    expect((await plan(csv, doc)).entries).toHaveLength(0);
  });

  it('does not bring back an imported entry the person deleted', async () => {
    const doc = newDoc();
    const csv = csvOf('C,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,');
    await runImport(doc, await plan(csv, doc), { deviceId: 'd' });
    const [e] = entriesOf(doc);
    collection(doc, 'time_entries').get(e!.id)!.set('deleted', true);
    const p = await plan(csv, doc);
    expect(p.entries).toHaveLength(0);
    expect(p.duplicatesExisting).toBe(1);
  });

  it('does not treat hand-made entries as duplicates', async () => {
    const doc = newDoc();
    createRecord(doc, 'time_entries', { start: '2025-01-01T09:00:00.000Z', stop: '2025-01-01T10:00:00.000Z', duration: 3600, description: 'x', project_id: null, task_id: null, tags: [], billable: false, device_id: 'd', created_at: 'a', updated_at: 'a', deleted: false });
    expect((await plan(csvOf(',,x,No,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,'), doc)).entries).toHaveLength(1);
  });

  it('the same file into two spaces imports into both', async () => {
    const a = newDoc();
    const b = newDoc();
    await runImport(a, await plan(SAMPLE, a, 'UTC'), { deviceId: 'd' });
    expect((await plan(SAMPLE, b, 'UTC')).entries).toHaveLength(9);
  });

  it('fingerprints do not depend on the row order or the time zone label, only the instants', () => {
    const a = importId({ start: '2025-01-01T09:00:00.000Z', stop: '2025-01-01T10:00:00.000Z', description: ' x ', project: 'P', client: 'C' });
    expect(a).toBe(importId({ start: '2025-01-01T09:00:00.000Z', stop: '2025-01-01T10:00:00.000Z', description: 'x', project: 'p', client: 'c' }));
    expect(a).not.toBe(importId({ start: '2025-01-01T09:00:00.000Z', stop: '2025-01-01T11:00:00.000Z', description: 'x', project: 'p', client: 'c' }));
  });
});

describe('matching existing projects, clients and tags', () => {
  const seed = (doc: Y.Doc) => {
    const client = createRecord(doc, 'clients', { name: 'Acme', archived: false, created_at: 'a', updated_at: 'a', deleted: false });
    const project = createRecord(doc, 'projects', { name: 'Website', client_id: client, color: '#2f6fde', billable: true, rate: 50, currency: 'EUR', active: true, created_at: 'a', updated_at: 'a', deleted: false });
    const loose = createRecord(doc, 'projects', { name: 'Admin', client_id: null, color: '#2f6fde', billable: false, rate: null, currency: 'USD', active: false, created_at: 'a', updated_at: 'a', deleted: false });
    createRecord(doc, 'tags', { name: 'Urgent', created_at: 'a', deleted: false });
    return { client, project, loose };
  };

  it('matches by name ignoring case, within the client, including archived projects', async () => {
    const doc = newDoc();
    const ids = seed(doc);
    const csv = csvOf('ACME,website,a,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,urgent', ',ADMIN,b,No,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,');
    const p = await plan(csv, doc);
    expect(p.newClients + p.newProjects).toBe(0);
    expect(p.newTags).toEqual([]);
    expect(p.entries[0]?.tags).toEqual(['Urgent']);
    await runImport(doc, p, { deviceId: 'd' });
    const e = entriesOf(doc);
    expect(e.find((x) => x.description === 'a')!.project_id).toBe(ids.project);
    expect(e.find((x) => x.description === 'b')!.project_id).toBe(ids.loose);
    expect(liveRecords(doc, 'projects')).toHaveLength(2);
    expect(liveRecords(doc, 'clients')).toHaveLength(1);
    // The existing project is left alone: no rate inferred, nothing overwritten.
    expect(collection(doc, 'projects').get(ids.project)!.toJSON()).toMatchObject({ rate: 50, currency: 'EUR', billable: true });
  });

  it('does not match a project of another client or of none', async () => {
    const doc = newDoc();
    seed(doc);
    const csv = csvOf(',Website,a,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,', 'Other,Admin,b,No,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,');
    const p = await plan(csv, doc);
    expect(p.newProjects).toBe(2);
    expect(p.newClients).toBe(1);
  });

  it('reuses an existing client for a new project', async () => {
    const doc = newDoc();
    const ids = seed(doc);
    const p = await plan(csvOf('acme,Brand new,a,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,'), doc);
    expect(p.newClients).toBe(0);
    expect(p.newProjects).toBe(1);
    await runImport(doc, p, { deviceId: 'd' });
    expect(liveRecords<Project>(doc, 'projects').find((x) => x.name === 'Brand new')!.client_id).toBe(ids.client);
  });

  it('ignores deleted projects, clients and tags when matching', async () => {
    const doc = newDoc();
    const ids = seed(doc);
    collection(doc, 'projects').get(ids.project)!.set('deleted', true);
    const p = await plan(csvOf('Acme,Website,a,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,'), doc);
    expect(p.newProjects).toBe(1);
  });

  it('creates a tag once however many entries use it, keeping the first spelling', async () => {
    const p = await plan(csvOf(',,a,No,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,"Focus, deep"', ',,b,No,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,"focus"'), newDoc());
    expect(p.newTags).toEqual(['Focus', 'deep']);
    expect(p.entries[1]?.tags).toEqual(['Focus']);
  });
});

describe('bad and unusual files', () => {
  it('reports malformed rows with their line and keeps going', async () => {
    const csv = csvOf(
      'C,P,ok,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,',
      'C,P,bad date,Yes,01/02/2025,09:00:00,2025-01-01,10:00:00,1:00:00,',
      'C,P,bad time,Yes,2025-01-01,9 o clock,2025-01-01,10:00:00,1:00:00,',
      'C,P,end first,Yes,2025-01-01,09:00:00,2025-01-01,08:00:00,,',
      'C,P,short row',
      '',
      'C,P,ok2,Yes,2025-01-02,09:00:00,2025-01-02,10:00:00,1:00:00,',
    );
    const p = await plan(csv, newDoc());
    expect(p.entries.map((e) => e.description)).toEqual(['ok', 'ok2']);
    expect(p.errorCount).toBe(4);
    expect(p.errors.map((e) => e.line)).toEqual([3, 4, 5, 6]);
    expect(p.errors[0]?.message).toMatch(/01\/02\/2025/);
  });

  it('works with only the columns it needs', async () => {
    const p = await plan('Start date,Start time,Duration\n2025-01-01,09:00:00,1:30:00\n', newDoc());
    expect(p.fileProblems).toEqual([]);
    expect(p.entries).toHaveLength(1);
    expect(p.entries[0]).toMatchObject({ description: '', projectKey: null, tags: [], billable: false, duration: 5400 });
  });

  it('works with a different column order, extra columns, a BOM and other case', async () => {
    const csv = '﻿FOO,duration,TAGS,start time,START DATE,description\r\nz,0:10:00,"a,b",08:00:00,2025-01-01,"hello"\r\n';
    const p = await plan(csv, newDoc());
    expect(p.entries[0]).toMatchObject({ description: 'hello', tags: ['a', 'b'], duration: 600, start: '2025-01-01T08:00:00.000Z' });
  });

  it('says what is missing and imports nothing', async () => {
    const p = await plan('Description,Project\nx,y\n', newDoc());
    expect(p.fileProblems.length).toBeGreaterThan(0);
    expect(p.entries).toEqual([]);
  });

  it('warns about several people and about tasks', async () => {
    const csv = 'Email,Task,Start date,Start time,Duration\na@example.com,T1,2025-01-01,09:00:00,1:00:00\nb@example.com,,2025-01-01,10:00:00,1:00:00\n';
    const p = await plan(csv, newDoc());
    expect(p.warnings.some((w) => /2 different people/.test(w))).toBe(true);
    expect(p.warnings.some((w) => /1 row has a Task/.test(w))).toBe(true);
  });

  it('never creates a running entry, even for a zero-length row', async () => {
    const doc = newDoc();
    await runImport(doc, await plan(csvOf(',,z,No,2025-01-01,09:00:00,2025-01-01,09:00:00,0:00:00,'), doc), { deviceId: 'd' });
    const [e] = entriesOf(doc);
    expect(e?.stop).toBe(e?.start);
    expect(e?.duration).toBe(0);
  });

  it('keeps descriptions that look like formulas as they are', async () => {
    const p = await plan(csvOf(',,=SUM(A1),No,2025-01-01,09:00:00,2025-01-01,09:10:00,0:10:00,'), newDoc());
    expect(p.entries[0]?.description).toBe('=SUM(A1)');
  });
});

describe('large files', () => {
  function big(rows: number): string {
    const out = [HEADER];
    for (let i = 0; i < rows; i++) {
      const day = new Date(Date.UTC(2020, 0, 1) + Math.floor(i / 8) * 86_400_000).toISOString().slice(0, 10);
      const h = 8 + (i % 8);
      out.push(`Client ${i % 5},Project ${i % 17},Task number ${i},Yes,${day},${String(h).padStart(2, '0')}:00:00,${day},${String(h).padStart(2, '0')}:45:00,0:45:00,tag${i % 9}`);
    }
    return out.join('\r\n');
  }

  it('plans and imports 30000 rows in many small transactions, reporting progress', async () => {
    const doc = newDoc();
    const p = await buildPlan(parseTogglFile(big(30_000)), readExisting(doc), { zone: 'Europe/Berlin' });
    expect(p.entries).toHaveLength(30_000);
    expect(p.errorCount).toBe(0);
    let transactions = 0;
    doc.on('afterTransaction', () => transactions++);
    const seen: number[] = [];
    const r = await runImport(doc, p, { deviceId: 'd', onProgress: (done) => seen.push(done) });
    expect(r.created).toBe(30_000);
    expect(entriesOf(doc)).toHaveLength(30_000);
    expect(transactions).toBe(1 + 100);
    expect(seen.at(-1)).toBe(30_000);
    expect(seen.length).toBeGreaterThan(100);
    const again = await buildPlan(parseTogglFile(big(30_000)), readExisting(doc), { zone: 'Europe/Berlin' });
    expect(again.entries).toHaveLength(0);
    expect(again.duplicatesExisting).toBe(30_000);
  }, 60_000);

  it('can be cancelled and then finished by importing again', async () => {
    const doc = newDoc();
    const csv = big(1000);
    const p = await plan(csv, doc);
    const controller = new AbortController();
    const r = await runImport(doc, p, { deviceId: 'd', entriesPerTransaction: 100, signal: controller.signal, onProgress: (done) => done >= 300 && controller.abort() });
    expect(r.cancelled).toBe(true);
    expect(r.created).toBe(300);
    expect(entriesOf(doc)).toHaveLength(300);
    const rest = await plan(csv, doc);
    expect(rest.entries).toHaveLength(700);
    expect(rest.newProjects).toBe(0);
    const r2 = await runImport(doc, rest, { deviceId: 'd' });
    expect(r2.cancelled).toBe(false);
    expect(entriesOf(doc)).toHaveLength(1000);
    expect(liveRecords(doc, 'projects')).toHaveLength(85); // 5 clients x 17 project names, each pair once
  });

  it('can stop planning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(buildPlan(parseTogglFile(big(5000)), readExisting(newDoc()), { zone: 'UTC', signal: controller.signal, sliceRows: 500 })).rejects.toThrow(/cancelled/);
  });
});

describe('merging with other devices', () => {
  it('a second device that has synced the first import skips the same entries', async () => {
    // Fingerprints travel with the entries. Two devices importing the same file before they have
    // synced would each add a copy (see docs/import.md): import on one device and let it sync.
    const a = newDoc();
    const b = newDoc();
    const csv = csvOf('C,P,x,Yes,2025-01-01,09:00:00,2025-01-01,10:00:00,1:00:00,');
    await runImport(a, await plan(csv, a), { deviceId: 'a' });
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
    expect((await plan(csv, b)).entries).toHaveLength(0);
  });
});
