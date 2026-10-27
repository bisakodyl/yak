/**
 * Parse a typed duration into seconds, or `null` when it cannot be read. Accepted forms:
 * `1:30` (h:mm), `1:30:15` (h:mm:ss), `90m`, `90 min`, `1.5h`, `1,5 h`, `1h 30m`, `2h15`, `45s`,
 * a plain whole number as minutes (`90`) and a plain decimal number as hours (`1.5`).
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/,/g, '.');
  if (!t) return null;

  const clock = /^(\d+):([0-5]?\d)(?::([0-5]?\d))?$/.exec(t);
  if (clock) return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3] ?? 0);

  if (/^\d+$/.test(t)) return Number(t) * 60;
  if (/^\d*\.\d+$/.test(t)) return Math.round(Number(t) * 3600);

  // A bare number right after hours is minutes: `2h15`.
  const short = /^(\d*\.?\d+)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)$/.exec(t);
  if (short) return Math.round(Number(short[1]) * 3600 + Number(short[2]) * 60);

  // Units: h, m, s with their usual spellings, in that order, each at most once.
  const num = '(\\d*\\.?\\d+)\\s*';
  const units = new RegExp(`^(?:${num}(?:h|hr|hrs|hours?))?\\s*(?:${num}(?:m|min|mins|minutes?))?\\s*(?:${num}(?:s|sec|secs|seconds?))?$`).exec(t);
  if (!units || (units[1] === undefined && units[2] === undefined && units[3] === undefined)) return null;
  const seconds = Number(units[1] ?? 0) * 3600 + Number(units[2] ?? 0) * 60 + Number(units[3] ?? 0);
  return Number.isFinite(seconds) ? Math.round(seconds) : null;
}
