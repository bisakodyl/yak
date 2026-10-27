import type * as Y from 'yjs';

/** Daily-note and template settings, kept in the account document's `settings` map. */

export interface DailySettings {
  /** Folder of daily notes inside a space. */
  folder: string;
  /** Name of a daily note, made of the tokens of `formatDate`. */
  format: string;
  /** Path of the template note; used when a note with that path exists in the space. */
  template: string;
}

export type PeriodKind = 'daily' | 'weekly' | 'monthly';

const DEFAULT_PERIODIC: Record<PeriodKind, DailySettings> = {
  daily: { folder: 'Daily', format: 'YYYY-MM-DD', template: 'Templates/Daily' },
  weekly: { folder: 'Weekly', format: 'GGGG-[W]WW', template: 'Templates/Weekly' },
  monthly: { folder: 'Monthly', format: 'YYYY-MM', template: 'Templates/Monthly' },
};

export const DEFAULT_DAILY: DailySettings = DEFAULT_PERIODIC.daily;

const keyOf = (kind: PeriodKind, field: keyof DailySettings): string => `${kind}_${field}`;

/** Settings of daily, weekly or monthly notes (keys `daily_folder`, `weekly_format`, …). */
export function readPeriodic(account: Y.Doc | undefined, kind: PeriodKind): DailySettings {
  const defaults = DEFAULT_PERIODIC[kind];
  if (!account) return defaults;
  const map = account.getMap<unknown>('settings');
  const text = (field: keyof DailySettings, fallback: string): string => {
    const v = map.get(keyOf(kind, field));
    return typeof v === 'string' ? v : fallback;
  };
  return {
    folder: text('folder', defaults.folder),
    format: text('format', defaults.format).trim() || defaults.format,
    template: text('template', defaults.template),
  };
}

export function writePeriodic<K extends keyof DailySettings>(account: Y.Doc, kind: PeriodKind, key: K, value: DailySettings[K]): void {
  account.getMap<unknown>('settings').set(keyOf(kind, key), value);
}

export const readDaily = (account: Y.Doc | undefined): DailySettings => readPeriodic(account, 'daily');
export const writeDaily = <K extends keyof DailySettings>(account: Y.Doc, key: K, value: DailySettings[K]): void => writePeriodic(account, 'daily', key, value);

/** ISO 8601 week (Monday first; week 1 holds the year's first Thursday) and the year it belongs to. */
function isoWeek(date: Date): { year: number; week: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const start = Date.UTC(d.getUTCFullYear(), 0, 1);
  return { year: d.getUTCFullYear(), week: Math.ceil(((d.getTime() - start) / 86_400_000 + 1) / 7) };
}

const pad = (n: number, width = 2): string => String(n).padStart(width, '0');

/**
 * Format a date from tokens: YYYY, YY, GGGG (ISO week year), WW (ISO week), MM, DD, HH, mm, ss, dddd (weekday name), ddd (short name).
 * Any other text stays as it is; wrap text that contains token letters in square brackets.
 */
export function formatDate(date: Date, format: string, locale?: string): string {
  return format.replace(/\[([^\]]*)\]|YYYY|GGGG|YY|WW|MM|DD|HH|mm|ss|dddd|ddd/g, (token, literal?: string) => {
    if (literal !== undefined) return literal;
    switch (token) {
      case 'YYYY':
        return pad(date.getFullYear(), 4);
      case 'GGGG':
        return pad(isoWeek(date).year, 4);
      case 'WW':
        return pad(isoWeek(date).week);
      case 'YY':
        return pad(date.getFullYear() % 100);
      case 'MM':
        return pad(date.getMonth() + 1);
      case 'DD':
        return pad(date.getDate());
      case 'HH':
        return pad(date.getHours());
      case 'mm':
        return pad(date.getMinutes());
      case 'ss':
        return pad(date.getSeconds());
      case 'dddd':
        return date.toLocaleDateString(locale, { weekday: 'long' });
      default:
        return date.toLocaleDateString(locale, { weekday: 'short' });
    }
  });
}

/**
 * Fill a template note: `{{date}}`, `{{time}}`, `{{title}}`, and `{{date:FORMAT}}` or `{{time:FORMAT}}`
 * with the tokens of `formatDate`. Unknown variables are left as written.
 */
export function expandTemplate(template: string, vars: { now: Date; title: string; locale?: string }): string {
  return template.replace(/\{\{\s*(date|time|title)\s*(?::([^}]*))?\}\}/g, (_all, name: string, format?: string) => {
    if (name === 'title') return vars.title;
    const fmt = format?.trim() || (name === 'date' ? 'YYYY-MM-DD' : 'HH:mm');
    return formatDate(vars.now, fmt, vars.locale);
  });
}
