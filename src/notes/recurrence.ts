/**
 * Recurring tasks, in TaskNotes' format (https://tasknotes.dev/features/recurring-tasks/): a
 * `recurrence` RRULE string (`DTSTART:20251004;FREQ=WEEKLY;BYDAY=MO,WE`), `scheduled` holding the
 * next open occurrence, `complete_instances` and `skipped_instances` listing dates. Only the
 * common part of RRULE is understood; any other rule is left alone (see `parseRule`).
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
const WEEKDAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

export interface Rule {
  freq: Freq;
  interval: number;
  /** Weekday numbers, 0 = Sunday. */
  byDay: number[];
  /** Day-of-month numbers; negative counts from the month's end (-1 = last day). */
  byMonthDay: number[];
  /** Day number (see `dayNumber`) of DTSTART, or null when the rule has none. */
  start: number | null;
  /** Day number of UNTIL, or null. */
  until: number | null;
}

/** Days since 1970-01-01 of a `YYYY-MM-DD…` or `YYYYMMDD…` string, or null. */
export function dayNumber(s: string): number | null {
  const m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s.trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000);
}

export function dayString(n: number): string {
  return new Date(n * 86400000).toISOString().slice(0, 10);
}

/** Parse a recurrence rule. Null when empty or when it uses parts we do not handle (COUNT, BYSETPOS, `5MO`, …). */
export function parseRule(text: string): Rule | null {
  const parts = new Map<string, string>();
  for (const seg of text.trim().split(/[;\n]/)) {
    const m = /^\s*(?:RRULE:)?([A-Za-z]+)[:=](.*)$/.exec(seg);
    if (m) parts.set((m[1] as string).toUpperCase(), (m[2] as string).trim());
  }
  const freq = parts.get('FREQ')?.toUpperCase();
  if (freq !== 'DAILY' && freq !== 'WEEKLY' && freq !== 'MONTHLY' && freq !== 'YEARLY') return null;
  for (const k of parts.keys()) if (!['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'DTSTART', 'UNTIL', 'WKST'].includes(k)) return null;
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1) return null;
  const byDay: number[] = [];
  for (const d of (parts.get('BYDAY') ?? '').split(',').filter(Boolean)) {
    const i = WEEKDAYS.indexOf(d.trim().toUpperCase());
    if (i < 0) return null;
    byDay.push(i);
  }
  const byMonthDay: number[] = [];
  for (const d of (parts.get('BYMONTHDAY') ?? '').split(',').filter(Boolean)) {
    const n = Number(d);
    if (!Number.isInteger(n) || n === 0 || n < -31 || n > 31) return null;
    byMonthDay.push(n);
  }
  const dt = parts.get('DTSTART');
  const un = parts.get('UNTIL');
  const start = dt ? dayNumber(dt) : null;
  const until = un ? dayNumber(un) : null;
  if ((dt && start === null) || (un && until === null)) return null;
  return { freq, interval, byDay, byMonthDay, start, until };
}

/** The `recurrence` text for a plain frequency, anchored at `start` (`YYYY-MM-DD`). */
export function simpleRule(freq: Freq, start: string): string {
  return `DTSTART:${start.replace(/-/g, '')};FREQ=${freq}`;
}

function ymd(n: number): { y: number; m: number; d: number; wd: number } {
  const dt = new Date(n * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth(), d: dt.getUTCDate(), wd: dt.getUTCDay() };
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

/** Does the rule produce an occurrence on `day`? `fallbackStart` anchors rules with no DTSTART. */
function occursOn(rule: Rule, day: number, fallbackStart: number): boolean {
  const start = rule.start ?? fallbackStart;
  if (day < start || (rule.until !== null && day > rule.until)) return false;
  const s = ymd(start);
  const t = ymd(day);
  switch (rule.freq) {
    case 'DAILY':
      return (day - start) % rule.interval === 0;
    case 'WEEKLY': {
      const days = rule.byDay.length ? rule.byDay : [s.wd];
      const weekOf = (n: number, wd: number): number => Math.floor((n - wd) / 7); // weeks start on Sunday
      return days.includes(t.wd) && (weekOf(day, t.wd) - weekOf(start, s.wd)) % rule.interval === 0;
    }
    case 'MONTHLY': {
      if ((t.y * 12 + t.m - (s.y * 12 + s.m)) % rule.interval !== 0) return false;
      const want = rule.byMonthDay.length ? rule.byMonthDay : [s.d];
      const last = daysInMonth(t.y, t.m);
      return want.some((n) => (n > 0 ? n : last + 1 + n) === t.d);
    }
    case 'YEARLY':
      return t.m === s.m && t.d === s.d && (t.y - s.y) % rule.interval === 0;
  }
}

/** Occurrence days in `[from, to]`, skipping `exclude`. */
export function occurrencesBetween(rule: Rule, from: number, to: number, fallbackStart: number, exclude: ReadonlySet<number> = new Set()): number[] {
  const out: number[] = [];
  for (let d = from; d <= to; d++) if (occursOn(rule, d, fallbackStart) && !exclude.has(d)) out.push(d);
  return out;
}

/** The first occurrence after `after` that is not excluded, searching up to ~10 years ahead; null when there is none. */
export function nextOccurrence(rule: Rule, after: number, fallbackStart: number, exclude: ReadonlySet<number> = new Set()): number | null {
  for (let d = after + 1; d <= after + 3660; d++) if (occursOn(rule, d, fallbackStart) && !exclude.has(d)) return d;
  return null;
}
