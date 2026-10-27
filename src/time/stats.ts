import { addDays, dayKey, startOfDay, startOfWeek, type WeekStart } from './dates';
import { type EntryRecord, entryDuration, startMs } from './entries';

/** A half-open range of epoch milliseconds: `from <= t < to`. */
export interface Range {
  from: number;
  to: number;
}

export function todayRange(now: number): Range {
  const from = startOfDay(now);
  return { from, to: addDays(from, 1) };
}

export function weekRange(now: number, weekStart: WeekStart = 'monday'): Range {
  const from = startOfWeek(now, weekStart);
  return { from, to: addDays(from, 7) };
}

/** Entries that started inside the range. An entry belongs to the local day it started on. */
export function entriesInRange(entries: readonly EntryRecord[], range: Range): EntryRecord[] {
  return entries.filter((e) => {
    const s = startMs(e);
    return s >= range.from && s < range.to;
  });
}

export function totalSeconds(entries: readonly EntryRecord[], now: number): number {
  let sum = 0;
  for (const e of entries) sum += entryDuration(e, now);
  return sum;
}

export interface DayGroup {
  /** Local `YYYY-MM-DD`. */
  key: string;
  /** Local midnight that starts the day. */
  dayStart: number;
  /** Newest first. */
  entries: EntryRecord[];
  totalSeconds: number;
}

/**
 * Group entries by the local day they started on, newest day first, with each day's total.
 * With `fill`, every day of the range gets a group, including days without entries.
 */
export function groupByDay(entries: readonly EntryRecord[], now: number, fill?: Range): DayGroup[] {
  const byKey = new Map<string, DayGroup>();
  const add = (dayStart: number): DayGroup => {
    const key = dayKey(dayStart);
    let g = byKey.get(key);
    if (!g) {
      g = { key, dayStart, entries: [], totalSeconds: 0 };
      byKey.set(key, g);
    }
    return g;
  };
  if (fill) for (let d = fill.from; d < fill.to; d = addDays(d, 1)) add(d);
  for (const e of entries) add(startOfDay(startMs(e))).entries.push(e);
  const groups = [...byKey.values()];
  for (const g of groups) {
    g.entries.sort((a, b) => startMs(b) - startMs(a) || (a.id < b.id ? 1 : -1));
    g.totalSeconds = totalSeconds(g.entries, now);
  }
  return groups.sort((a, b) => b.dayStart - a.dayStart);
}
