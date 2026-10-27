import type * as Y from 'yjs';
import { readRate } from '../core/rates';
import { collection } from '../core/schema';
import type { ReportSource, SourceClient, SourceEntry, SourceProject } from './aggregate';
import { readSettings } from '../core/settings';
import type { HoursFormat } from './format';
import type { WeekStart } from './dates';

/**
 * Reads the record shapes of docs/architecture.md straight from the space documents, with no
 * dependency on the time module. Every field is read defensively: another device may be on a
 * slightly different version, and a report must show what it can instead of failing.
 */

export interface SpaceDoc {
  spaceId: string;
  name: string;
  /** The space's main document: projects and clients. */
  doc: Y.Doc;
  /** The space's private part: entries and rates. Defaults to `doc` (the first layout, and tests). */
  privateDoc?: Y.Doc;
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

function strings(v: unknown): string[] {
  const arr = Array.isArray(v) ? v : typeof (v as { toArray?: unknown } | null)?.toArray === 'function' ? (v as { toArray(): unknown[] }).toArray() : [];
  return arr.filter((x): x is string => typeof x === 'string');
}

function eachRecord(doc: Y.Doc, name: 'time_entries' | 'projects' | 'clients', fn: (id: string, get: (k: string) => unknown) => void): void {
  collection(doc, name).forEach((record, id) => fn(id, (k) => record.get(k)));
}

export function loadSource(spaces: SpaceDoc[]): ReportSource {
  const entries: SourceEntry[] = [];
  const projects: SourceProject[] = [];
  const clients: SourceClient[] = [];
  const spaceNames: Record<string, string> = {};
  for (const { spaceId, name, doc, privateDoc } of spaces) {
    spaceNames[spaceId] = name;
    eachRecord(privateDoc ?? doc, 'time_entries', (id, get) =>
      entries.push({
        id,
        spaceId,
        start: str(get('start')),
        stop: strOrNull(get('stop')),
        description: str(get('description')),
        projectId: strOrNull(get('project_id')),
        tags: strings(get('tags')),
        billable: get('billable') === true,
        deleted: get('deleted') === true,
      }),
    );
    eachRecord(doc, 'projects', (id, get) => {
      // A private rate (the space's private part) wins over the first layout's rate on the project.
      const own = privateDoc ? readRate(privateDoc, id) : undefined;
      const rate = own ? own.rate : get('rate');
      projects.push({
        id,
        spaceId,
        name: str(get('name')),
        clientId: strOrNull(get('client_id')),
        color: str(get('color')),
        rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
        currency: own ? own.currency : str(get('currency'), 'USD') || 'USD',
        active: get('active') !== false,
        deleted: get('deleted') === true,
      });
    });
    eachRecord(doc, 'clients', (id, get) =>
      clients.push({ id, spaceId, name: str(get('name')), archived: get('archived') === true, deleted: get('deleted') === true }),
    );
  }
  return { entries, projects, clients, spaceNames };
}

/** The shared settings live in the account document. */
export function settingsMap(account: Y.Doc | undefined): Y.Map<unknown> | undefined {
  return account?.getMap<unknown>('settings');
}

export function readHoursFormat(account: Y.Doc | undefined): HoursFormat {
  return readSettings(account).hours_format;
}

export function readWeekStart(account: Y.Doc | undefined): WeekStart {
  return readSettings(account).week_start;
}
