/**
 * Wall-clock time in a named IANA time zone to UTC instants, using only `Intl`.
 * Toggl exports carry no offset, so the zone is chosen by the person importing.
 */

const formatters = new Map<string, Intl.DateTimeFormat>();

export function isValidTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The browser's own time zone, or `UTC` when it cannot be determined. */
export function browserTimeZone(): string {
  try {
    const z = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return z && isValidTimeZone(z) ? z : 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Zone names for the picker: everything the browser knows, with the given zone and UTC always present. */
export function timeZoneChoices(extra: string[] = []): string[] {
  let names: string[] = [];
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') names = supported('timeZone');
  } catch {
    names = [];
  }
  return [...new Set(['UTC', ...extra, ...names])].sort((a, b) => a.localeCompare(b));
}

function formatterFor(zone: string): Intl.DateTimeFormat {
  let f = formatters.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formatters.set(zone, f);
  }
  return f;
}

const BUCKET_MS = 15 * 60 * 1000;
const offsetCache = new Map<string, number>();

/**
 * Offset of `zone` from UTC in milliseconds at an instant (positive east of Greenwich).
 * Offsets only change on 15-minute boundaries of UTC, so results are cached per 15 minutes.
 */
export function zoneOffsetMs(zone: string, utcMs: number): number {
  const bucket = Math.floor(utcMs / BUCKET_MS);
  const key = `${zone}|${bucket}`;
  const cached = offsetCache.get(key);
  if (cached !== undefined) return cached;
  const probe = bucket * BUCKET_MS;
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;
  for (const p of formatterFor(zone).formatToParts(new Date(probe))) {
    const v = Number(p.value);
    if (p.type === 'year') year = v;
    else if (p.type === 'month') month = v;
    else if (p.type === 'day') day = v;
    else if (p.type === 'hour') hour = v;
    else if (p.type === 'minute') minute = v;
    else if (p.type === 'second') second = v;
  }
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  const offset = asUtc - probe;
  if (offsetCache.size > 50_000) offsetCache.clear();
  offsetCache.set(key, offset);
  return offset;
}

export interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/**
 * The UTC instants at which the wall clock of `zone` shows `local`, earliest first.
 * - Normal time: one instant.
 * - A clock set back (the hour repeats): two instants.
 * - A clock set forward (the time does not exist): one instant, read with the offset in force
 *   before the change, so 02:30 on a spring-forward night becomes 03:30 local.
 */
export function localToUtcCandidates(zone: string, local: LocalParts): number[] {
  const wall = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second);
  const before = zoneOffsetMs(zone, wall - 86_400_000);
  const after = zoneOffsetMs(zone, wall + 86_400_000);
  const found = new Set<number>();
  for (const offset of new Set([before, after])) {
    const candidate = wall - offset;
    if (zoneOffsetMs(zone, candidate) === offset) found.add(candidate);
  }
  if (found.size === 0) return [wall - before];
  return [...found].sort((a, b) => a - b);
}

/** `YYYY-MM-DD` of an instant as seen in a zone. */
export function dayKeyInZone(zone: string, utcMs: number): string {
  const d = new Date(utcMs + zoneOffsetMs(zone, utcMs));
  return d.toISOString().slice(0, 10);
}
