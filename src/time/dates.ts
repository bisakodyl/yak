/** Local-calendar helpers. Days and weeks are the user's local days; times are epoch milliseconds. */

export type WeekStart = 'monday' | 'sunday';

export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Move by whole local days; stays on local midnight across daylight-saving changes. */
export function addDays(ms: number, days: number): number {
  const d = new Date(ms);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

export function startOfWeek(ms: number, weekStart: WeekStart = 'monday'): number {
  const dow = new Date(ms).getDay(); // 0 = Sunday
  const back = weekStart === 'monday' ? (dow + 6) % 7 : dow;
  return addDays(startOfDay(ms), -back);
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DD` of the local day containing `ms`. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Value for an `<input type="datetime-local">`: `YYYY-MM-DDTHH:mm`, local time. */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${dayKey(ms)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Inverse of `toLocalInput`; `null` when the text is not a valid local date-time. */
export function fromLocalInput(text: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((x) => (x === undefined ? 0 : Number(x))) as [number, number, number, number, number, number];
  const date = new Date(y, mo - 1, d, h, mi, s);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== mo - 1) return null;
  return date.getTime();
}

export function isoToMs(iso: string | null | undefined): number {
  if (!iso) return NaN;
  return new Date(iso).getTime();
}
