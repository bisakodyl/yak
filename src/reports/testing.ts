import { afterEach, beforeEach } from 'vitest';
import type { ReportSource, SourceClient, SourceEntry, SourceProject } from './aggregate';

// The project has no Node typings; tests run in Node, where assigning `process.env.TZ` switches the zone.
const env = (globalThis as unknown as { process: { env: Record<string, string | undefined> } }).process.env;

/** Run the tests of a `describe` block in a given time zone, restoring the previous one afterwards. */
export function useTimeZone(tz: string): void {
  let previous: string | undefined;
  beforeEach(() => {
    previous = env.TZ;
    env.TZ = tz;
  });
  afterEach(() => {
    if (previous === undefined) delete env.TZ;
    else env.TZ = previous;
  });
}

/** Local time as milliseconds; month is 1-based. */
export const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0): number => new Date(y, mo - 1, d, h, mi, s).getTime();

let counter = 0;

export function entry(p: Partial<SourceEntry> & { startMs: number; endMs?: number | null }): SourceEntry {
  const { startMs, endMs, ...rest } = p;
  counter += 1;
  return {
    id: `e${counter}`,
    spaceId: 'personal',
    start: new Date(startMs).toISOString(),
    stop: endMs === undefined || endMs === null ? (endMs === null ? null : new Date(startMs + 3_600_000).toISOString()) : new Date(endMs).toISOString(),
    description: '',
    projectId: null,
    tags: [],
    billable: false,
    deleted: false,
    ...rest,
  };
}

export function project(p: Partial<SourceProject> & { id: string }): SourceProject {
  return { spaceId: 'personal', name: p.id, clientId: null, color: '#336699', rate: null, currency: 'USD', active: true, deleted: false, ...p };
}

export function client(c: Partial<SourceClient> & { id: string }): SourceClient {
  return { spaceId: 'personal', name: c.id, archived: false, deleted: false, ...c };
}

export function source(parts: Partial<ReportSource>): ReportSource {
  return { entries: [], projects: [], clients: [], spaceNames: { personal: 'Personal', work: 'Work' }, ...parts };
}
