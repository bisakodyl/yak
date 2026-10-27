import { type DetailRow, type Group, type GroupBy, type Totals, GROUP_BY_OPTIONS } from './aggregate';
import { dayKey } from './dates';
import {
  type HoursFormat,
  clockDuration,
  clockTime,
  decimalHours,
  formatAmounts,
  formatDuration,
  formatPercent,
} from './format';

/** Exports: Markdown for pasting into notes, CSV as a derived file. CSV is never read back in. */

const groupName = (g: GroupBy): string => GROUP_BY_OPTIONS.find((o) => o.id === g)?.label ?? g;

function cell(text: string): string {
  return text.replace(/\r?\n|\r/g, ' ').replace(/\\/g, '\\\\').replace(/\|/g, '\\|').trim();
}

export interface MarkdownInput {
  rangeText: string;
  totals: Totals;
  groups: Group[];
  groupBy: GroupBy;
  thenBy: GroupBy | null;
  format: HoursFormat;
  /** Human-readable active filters, for example `Project: Acme`. */
  filterText: string[];
  spaceText: string;
  locale?: string;
}

/** The summary as a Markdown table; one sentence or fact per line. */
export function summaryMarkdown(i: MarkdownInput): string {
  const lines: string[] = [];
  lines.push(`## Time report ${i.rangeText}`);
  lines.push('');
  lines.push(`- Space: ${i.spaceText}`);
  lines.push(`- Total: ${formatDuration(i.totals.ms, i.format)}`);
  lines.push(`- Billable: ${formatDuration(i.totals.billableMs, i.format)}`);
  lines.push(`- Amount: ${formatAmounts(i.totals.amounts, i.locale)}`);
  for (const f of i.filterText) lines.push(`- Filter: ${f}`);
  lines.push('');
  const first = groupName(i.groupBy);
  lines.push(`| ${first}${i.thenBy ? ` / ${groupName(i.thenBy)}` : ''} | Duration | Share | Amount |`);
  lines.push('| --- | ---: | ---: | ---: |');
  for (const g of i.groups) {
    lines.push(row(i.thenBy ? `**${cell(g.label)}**` : cell(g.label), g, i));
    for (const c of g.children) lines.push(row(`↳ ${cell(c.label)}`, c, i));
  }
  lines.push(`| **Total** | **${formatDuration(i.totals.ms, i.format)}** | | **${formatAmounts(i.totals.amounts, i.locale)}** |`);
  if (i.groupBy === 'tag' || i.thenBy === 'tag') {
    lines.push('');
    lines.push('Entries with several tags are counted under each tag, so the rows can add up to more than the total.');
  }
  return lines.join('\n') + '\n';
}

function row(label: string, g: Group, i: MarkdownInput): string {
  return `| ${label} | ${formatDuration(g.ms, i.format)} | ${formatPercent(g.ms, i.totals.ms)} | ${formatAmounts(g.amounts, i.locale)} |`;
}

// ---------------------------------------------------------------- CSV

/**
 * RFC 4180 quoting. Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would be run
 * as a formula by spreadsheet programs, so it gets a leading apostrophe.
 */
export function csvField(value: string): string {
  let v = value;
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export const CSV_HEADER = [
  'Space',
  'Client',
  'Project',
  'Description',
  'Billable',
  'Start date',
  'Start time',
  'End date',
  'End time',
  'Duration (h:mm:ss)',
  'Duration (hours)',
  'Tags',
  'Amount',
  'Currency',
] as const;

export function detailCsv(rows: DetailRow[], spaceNames: Record<string, string>): string {
  const out: string[] = [CSV_HEADER.map(csvField).join(',')];
  for (const r of rows) {
    const fields = [
      spaceNames[r.spaceId] ?? r.spaceId,
      r.clientLabel,
      r.projectLabel,
      r.description,
      r.billable ? 'Yes' : 'No',
      dayKey(r.startMs),
      clockTime(r.startMs, true),
      r.running ? '' : dayKey(r.endMs),
      r.running ? '' : clockTime(r.endMs, true),
      clockDuration(r.ms),
      decimalHours(r.ms),
      r.tags.join(', '),
      r.amount === null ? '' : r.amount.toFixed(2),
      r.amount === null ? '' : r.currency,
    ];
    out.push(fields.map(csvField).join(','));
  }
  return out.join('\r\n') + '\r\n';
}
