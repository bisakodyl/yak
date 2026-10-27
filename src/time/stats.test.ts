import { describe, expect, it } from 'vitest';
import { dayKey, fromLocalInput, startOfWeek, toLocalInput } from './dates';
import { addManualEntry, liveEntries } from './entries';
import { formatClock, formatDayLabel, formatHours } from './format';
import { entriesInRange, groupByDay, todayRange, totalSeconds, weekRange } from './stats';
import { at, makeSpaceDocs } from './testing';

function entriesAt(spans: [number, number][]) {
  const doc = makeSpaceDocs().get('personal')!;
  for (const [start, stop] of spans) addManualEntry(doc, 'd', { start, stop });
  return liveEntries(doc);
}

describe('dates', () => {
  it('starts the week on Monday by default and on Sunday on request', () => {
    const wed = at(2026, 10, 14, 15);
    expect(dayKey(startOfWeek(wed))).toBe('2026-10-12');
    expect(dayKey(startOfWeek(at(2026, 10, 18, 23, 59)))).toBe('2026-10-12');
    expect(dayKey(startOfWeek(at(2026, 10, 12, 0, 0)))).toBe('2026-10-12');
    expect(dayKey(startOfWeek(wed, 'sunday'))).toBe('2026-10-11');
  });

  it('round-trips datetime-local text', () => {
    const t = at(2026, 3, 5, 7, 9);
    expect(toLocalInput(t)).toBe('2026-03-05T07:09');
    expect(fromLocalInput('2026-03-05T07:09')).toBe(t);
    expect(fromLocalInput('')).toBeNull();
    expect(fromLocalInput('2026-02-31T07:09')).toBeNull();
  });

  it('week ranges are seven local days even across a daylight-saving change', () => {
    const r = weekRange(at(2026, 3, 11, 12));
    expect(dayKey(r.from)).toBe('2026-03-09');
    expect(dayKey(r.to)).toBe('2026-03-16');
  });
});

describe('formatting', () => {
  it('formats decimal hours and h:mm', () => {
    expect(formatHours(4500)).toBe('1.25 h');
    expect(formatHours(0)).toBe('0.00 h');
    expect(formatHours(4500, 'hm')).toBe('1:15');
    expect(formatHours(59 * 60 + 40, 'hm')).toBe('1:00');
    expect(formatHours(36_000 + 5 * 60, 'hm')).toBe('10:05');
    expect(formatHours(-5)).toBe('0.00 h');
  });

  it('formats a running clock', () => {
    expect(formatClock(3725)).toBe('1:02:05');
    expect(formatClock(5)).toBe('0:00:05');
  });

  it('labels today and yesterday', () => {
    const now = at(2026, 10, 14, 12);
    expect(formatDayLabel(at(2026, 10, 14), now)).toBe('Today');
    expect(formatDayLabel(at(2026, 10, 13), now)).toBe('Yesterday');
    expect(formatDayLabel(at(2026, 10, 9), now)).not.toBe('Today');
  });
});

describe('queries and grouping', () => {
  const now = at(2026, 10, 14, 16); // a Wednesday
  const es = entriesAt([
    [at(2026, 10, 14, 9), at(2026, 10, 14, 10, 30)], // today 1.5 h
    [at(2026, 10, 14, 11), at(2026, 10, 14, 11, 15)], // today 0.25 h
    [at(2026, 10, 13, 9), at(2026, 10, 13, 17)], // yesterday 8 h
    [at(2026, 10, 11, 20), at(2026, 10, 11, 21)], // previous Sunday
    [at(2026, 10, 12, 0, 0, 0), at(2026, 10, 12, 1)], // Monday midnight, belongs to this week
  ]);

  it('selects today and this week by start time', () => {
    expect(entriesInRange(es, todayRange(now))).toHaveLength(2);
    expect(entriesInRange(es, weekRange(now))).toHaveLength(4);
    expect(totalSeconds(entriesInRange(es, todayRange(now)), now)).toBe(6300);
  });

  it('groups by day, newest first, with totals', () => {
    const g = groupByDay(entriesInRange(es, weekRange(now)), now);
    expect(g.map((x) => x.key)).toEqual(['2026-10-14', '2026-10-13', '2026-10-12']);
    expect(g.map((x) => x.totalSeconds)).toEqual([6300, 28800, 3600]);
    expect(g[0]!.entries.map((e) => e.start)).toEqual([new Date(at(2026, 10, 14, 11)).toISOString(), new Date(at(2026, 10, 14, 9)).toISOString()]);
  });

  it('can fill empty days of a range', () => {
    const range = weekRange(now);
    const g = groupByDay(entriesInRange(es, range), now, range);
    expect(g).toHaveLength(7);
    expect(g.map((x) => x.key)[0]).toBe('2026-10-18');
    expect(g.filter((x) => x.entries.length === 0)).toHaveLength(4);
  });

  it('counts a running entry up to now', () => {
    const doc = makeSpaceDocs().get('personal')!;
    addManualEntry(doc, 'd', { start: at(2026, 10, 14, 9), stop: at(2026, 10, 14, 10) });
    const list = liveEntries(doc);
    list.push({ ...list[0]!, id: 'r', start: new Date(at(2026, 10, 14, 15)).toISOString(), stop: null, duration: 0 });
    expect(totalSeconds(list, now)).toBe(3600 + 3600);
  });
});
