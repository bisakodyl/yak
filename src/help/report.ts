/** Builds the problem report the person sees, copies, downloads or emails. No note or entry contents go in. */

export interface ReportInput {
  what: string;
  expected: string;
  /** Add app version, browser, device, page and the last day of the debug log. */
  includeDetails: boolean;
  appName: string;
  version: string;
  userAgent: string;
  /** For example `1280x800 @2x, en-US`. */
  device: string;
  page: string;
  /** The device's debug log, already limited to the last day. */
  logText: string;
  now: Date;
}

export function buildReport(i: ReportInput): string {
  const lines = [`${i.appName} problem report`, i.now.toISOString(), '', 'What happened:', i.what.trim() || '(not said)', '', 'What I expected:', i.expected.trim() || '(not said)'];
  if (i.includeDetails) {
    lines.push('', 'Details:', `App version: ${i.version}`, `Browser: ${i.userAgent}`, `Device: ${i.device}`, `Page: ${i.page}`, '', 'Debug log (last 24 hours, this device):', i.logText.trim() || '(empty)');
  }
  return lines.join('\n');
}

/** Log lines of the last day only. */
export function lastDay<T extends { at: number }>(entries: readonly T[], now: number): T[] {
  return entries.filter((e) => now - e.at <= 24 * 60 * 60 * 1000);
}

/** "Yak problem: first few words". */
export function subjectFor(appName: string, what: string): string {
  const words = what.trim().split(/\s+/).filter(Boolean).slice(0, 8).join(' ');
  return `${appName} problem${words ? `: ${words}` : ''}`;
}

/** Mail links get cut off by some apps near 2000 characters, so the link carries a short body; the full report is copied. */
export const MAIL_BODY_MAX = 1200;

export function mailtoUrl(to: string, subject: string, i: Pick<ReportInput, 'what' | 'expected' | 'version' | 'userAgent' | 'device' | 'page' | 'includeDetails'>): string {
  const parts = [`What happened:\n${i.what.trim() || '(not said)'}`, `What I expected:\n${i.expected.trim() || '(not said)'}`];
  if (i.includeDetails) parts.push(`App version: ${i.version}\nDevice: ${i.device}\nPage: ${i.page}`);
  parts.push('Full report copied; paste or attach it.');
  const body = parts.join('\n\n').slice(0, MAIL_BODY_MAX);
  return `mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function fileNameFor(appName: string, now: Date): string {
  return `${appName.toLowerCase()}-report-${now.toISOString().slice(0, 10)}.txt`;
}
