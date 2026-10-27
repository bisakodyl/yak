import { describe, expect, it } from 'vitest';
import { dayKeyInZone, isValidTimeZone, localToUtcCandidates, zoneOffsetMs } from './zone';

const local = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0) => ({ year, month, day, hour, minute, second });
const iso = (ms: number): string => new Date(ms).toISOString();

describe('zone', () => {
  it('validates zone names', () => {
    expect(isValidTimeZone('Europe/Berlin')).toBe(true);
    expect(isValidTimeZone('UTC')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
  });

  it('knows offsets in winter and summer', () => {
    expect(zoneOffsetMs('Europe/Berlin', Date.UTC(2025, 0, 15))).toBe(3_600_000);
    expect(zoneOffsetMs('Europe/Berlin', Date.UTC(2025, 6, 15))).toBe(7_200_000);
    expect(zoneOffsetMs('America/New_York', Date.UTC(2025, 6, 15))).toBe(-4 * 3_600_000);
    expect(zoneOffsetMs('Asia/Kolkata', Date.UTC(2025, 6, 15))).toBe(5.5 * 3_600_000);
  });

  it('converts ordinary wall-clock times', () => {
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 1, 15, 9)).map(iso)).toEqual(['2025-01-15T08:00:00.000Z']);
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 7, 15, 9)).map(iso)).toEqual(['2025-07-15T07:00:00.000Z']);
    expect(localToUtcCandidates('UTC', local(2025, 7, 15, 9)).map(iso)).toEqual(['2025-07-15T09:00:00.000Z']);
    expect(localToUtcCandidates('Asia/Kolkata', local(2025, 7, 15, 9, 30)).map(iso)).toEqual(['2025-07-15T04:00:00.000Z']);
  });

  it('resolves a time that does not exist (clock set forward) by reading it with the earlier offset', () => {
    // Berlin 2025-03-30: 02:00 CET jumps to 03:00 CEST, so 02:30 does not exist.
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 3, 30, 2, 30)).map(iso)).toEqual(['2025-03-30T01:30:00.000Z']);
    // New York 2025-03-09.
    expect(localToUtcCandidates('America/New_York', local(2025, 3, 9, 2, 30)).map(iso)).toEqual(['2025-03-09T07:30:00.000Z']);
  });

  it('gives both instants for a time that happens twice (clock set back)', () => {
    // Berlin 2025-10-26: 03:00 CEST goes back to 02:00 CET, so 02:30 happens twice.
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 10, 26, 2, 30)).map(iso)).toEqual(['2025-10-26T00:30:00.000Z', '2025-10-26T01:30:00.000Z']);
    expect(localToUtcCandidates('America/New_York', local(2025, 11, 2, 1, 30)).map(iso)).toEqual(['2025-11-02T05:30:00.000Z', '2025-11-02T06:30:00.000Z']);
  });

  it('is exact just before and after a change', () => {
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 3, 30, 1, 59, 59)).map(iso)).toEqual(['2025-03-30T00:59:59.000Z']);
    expect(localToUtcCandidates('Europe/Berlin', local(2025, 3, 30, 3, 0, 0)).map(iso)).toEqual(['2025-03-30T01:00:00.000Z']);
  });

  it('handles a half-hour change (Lord Howe)', () => {
    // Lord Howe Island moves its clock by 30 minutes: 2025-04-06 02:00 DST (+11) back to 01:30 standard (+10:30).
    const c = localToUtcCandidates('Australia/Lord_Howe', local(2025, 4, 6, 1, 45));
    expect(c).toHaveLength(2);
    expect(c[1]! - c[0]!).toBe(30 * 60_000);
  });

  it('gives the local day of an instant', () => {
    expect(dayKeyInZone('Europe/Berlin', Date.UTC(2025, 2, 29, 23, 30))).toBe('2025-03-30');
    expect(dayKeyInZone('America/New_York', Date.UTC(2025, 2, 30, 2, 0))).toBe('2025-03-29');
  });
});
