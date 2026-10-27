import * as Y from 'yjs';
import { describe, expect, test } from 'vitest';
import { createRecord, initSpaceDoc, softDelete } from '../core/schema';
import { NO_FILTERS, buildReport } from './aggregate';
import { loadSource, readHoursFormat, readWeekStart } from './source';
import { at, useTimeZone } from './testing';

function doc(): Y.Doc {
  const d = new Y.Doc();
  initSpaceDoc(d);
  return d;
}

const H = 3_600_000;

describe('loadSource reads the documented record shapes', () => {
  useTimeZone('Europe/Berlin');

  test('entries, projects and clients from two space documents', () => {
    const personal = doc();
    const work = doc();
    const clientId = createRecord(work, 'clients', { name: 'Acme', archived: false, created_at: '', updated_at: '', deleted: false });
    const projectId = createRecord(work, 'projects', { name: 'Site', client_id: clientId, color: '#112233', billable: true, rate: 50, currency: 'EUR', active: true, created_at: '', updated_at: '', deleted: false });
    createRecord(work, 'time_entries', {
      start: new Date(at(2025, 3, 10, 9)).toISOString(),
      stop: new Date(at(2025, 3, 10, 11)).toISOString(),
      duration: 7200,
      description: 'Work',
      project_id: projectId,
      task_id: null,
      tags: ['x', 'y'],
      billable: true,
      device_id: 'd',
      created_at: '',
      updated_at: '',
      deleted: false,
    });
    const gone = createRecord(personal, 'time_entries', { start: new Date(at(2025, 3, 10, 9)).toISOString(), stop: new Date(at(2025, 3, 10, 10)).toISOString(), description: 'oops', project_id: null, tags: [], billable: false, deleted: false });
    softDelete(personal, 'time_entries', gone);
    createRecord(personal, 'time_entries', { start: new Date(at(2025, 3, 11, 9)).toISOString(), stop: null, description: 'running', project_id: null, tags: [], billable: false, deleted: false });

    const src = loadSource([
      { spaceId: 'personal', name: 'Personal', doc: personal },
      { spaceId: 'work', name: 'Work', doc: work },
    ]);
    expect(src.entries).toHaveLength(3);
    expect(src.projects[0]).toMatchObject({ name: 'Site', rate: 50, currency: 'EUR', active: true, clientId });
    const r = buildReport(src, {
      now: at(2025, 3, 11, 10),
      range: { from: at(2025, 3, 10), to: at(2025, 3, 17) },
      weekStart: 'monday',
      filters: NO_FILTERS,
      groupBy: 'client',
      thenBy: null,
      multiSpace: true,
    });
    expect(r.totals.ms).toBe(3 * H);
    expect(r.totals.amounts).toEqual({ EUR: 100 });
    expect(r.groups.map((g) => g.label).sort()).toEqual(['(No client)', 'Acme · Work']);
  });

  test('tolerates missing and odd fields', () => {
    const d = doc();
    createRecord(d, 'time_entries', { start: new Date(at(2025, 3, 10, 9)).toISOString() });
    createRecord(d, 'projects', { name: 5, rate: 'x' });
    const src = loadSource([{ spaceId: 'personal', name: 'Personal', doc: d }]);
    expect(src.entries[0]).toMatchObject({ stop: null, tags: [], billable: false, description: '' });
    expect(src.projects[0]).toMatchObject({ name: '', rate: null, currency: 'USD', active: true });
  });
});

describe('shared settings', () => {
  test('defaults', () => {
    const d = doc();
    expect(readHoursFormat(d)).toBe('decimal');
    expect(readWeekStart(d)).toBe('monday');
    expect(readHoursFormat(undefined)).toBe('decimal');
  });

  test('read from the settings map of the Personal document', () => {
    const d = doc();
    d.getMap('settings').set('hours_format', 'h:mm');
    d.getMap('settings').set('week_start', 'sunday');
    expect(readHoursFormat(d)).toBe('hm');
    expect(readWeekStart(d)).toBe('sunday');
  });
});
