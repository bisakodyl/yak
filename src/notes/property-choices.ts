import { DEFAULT_STATUSES } from './tasks';
import type { Properties } from './frontmatter';

/** The values the properties table offers for the properties that have a fixed set of usual values. */
export interface PropertyChoices {
  status: string[];
  priority: string[];
  projects: string[];
  contexts: string[];
}

/** TaskNotes' priorities, lowest first. */
const DEFAULT_PRIORITIES = ['none', 'low', 'normal', 'high'] as const;

const strings = (value: unknown): string[] => {
  const raw = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '').map((v) => v.trim());
};

function addUnique(into: string[], values: readonly string[]): void {
  for (const v of values) if (!into.some((x) => x.toLowerCase() === v.toLowerCase())) into.push(v);
}

/**
 * The usual values first, then any other value the space's notes already use (a custom status from
 * another tool stays selectable). `projects` and `contexts` are only what other notes use.
 */
export function propertyChoices(all: readonly { properties: Properties }[]): PropertyChoices {
  const out: PropertyChoices = { status: [...DEFAULT_STATUSES], priority: [...DEFAULT_PRIORITIES], projects: [], contexts: [] };
  for (const n of all) {
    addUnique(out.status, strings(n.properties.status));
    addUnique(out.priority, strings(n.properties.priority));
    addUnique(out.projects, strings(n.properties.projects));
    addUnique(out.contexts, strings(n.properties.contexts));
  }
  out.projects.sort((a, b) => a.localeCompare(b));
  out.contexts.sort((a, b) => a.localeCompare(b));
  return out;
}

const DATE_ONLY = /^(\d{4}-\d{2}-\d{2})$/;
const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/;

/** A date (and optional local time) property value, or null when it has another form (a zone, text) that is kept as written. */
export function parseDateValue(value: unknown): { date: string; time: string } | null {
  if (value === null || value === undefined || value === '') return { date: '', time: '' };
  if (typeof value !== 'string') return null;
  const d = DATE_ONLY.exec(value);
  if (d) return { date: d[1]!, time: '' };
  const t = DATE_TIME.exec(value);
  return t ? { date: t[1]!, time: t[2]! } : null;
}

/** TaskNotes' formats: `YYYY-MM-DD`, or `YYYY-MM-DDTHH:mm` with a time; null for no date. */
export function formatDateValue(date: string, time: string): string | null {
  if (!date) return null;
  return time ? `${date}T${time}` : date;
}

/** Properties that hold a date, so an empty one still gets a date picker. */
export const DATE_PROPERTIES = new Set(['due', 'scheduled', 'start', 'end', 'completeddate']);
