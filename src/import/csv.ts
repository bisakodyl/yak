/**
 * A small CSV reader (RFC 4180 plus the usual leniencies). No dependencies.
 * Handles quoted cells, doubled quotes, newlines inside quotes, CRLF / LF / CR line ends, a
 * UTF-8 byte-order mark, and comma, semicolon or tab separators (detected from the first line).
 */

export type Delimiter = ',' | ';' | '\t';

export interface CsvResult {
  /** Every non-blank record, each an array of cells. Row `i` starts on line `lines[i]` of the file. */
  rows: string[][];
  /** 1-based line number on which each row starts, for error messages. */
  lines: number[];
  delimiter: Delimiter;
  /** True when the file ended inside a quoted cell (the cell is kept as read). */
  unterminatedQuote: boolean;
}

/** Remove one leading byte-order mark. */
export function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Pick the separator that occurs most often outside quotes in the first record. Comma wins ties. */
export function detectDelimiter(text: string): Delimiter {
  const counts: Record<Delimiter, number> = { ',': 0, ';': 0, '\t': 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes) {
      if (c === '\n' || c === '\r') break;
      if (c === ',' || c === ';' || c === '\t') counts[c]++;
    }
  }
  if (counts[','] >= counts[';'] && counts[','] >= counts['\t']) return ',';
  return counts[';'] >= counts['\t'] ? ';' : '\t';
}

interface CsvRecord {
  cells: string[];
  line: number;
}

/** Reads records one at a time. `state.unterminatedQuote` is set if the text ends inside a quote. */
function* records(text: string, delim: Delimiter, state: { unterminatedQuote: boolean }): Generator<CsvRecord> {
  const n = text.length;
  let i = 0;
  let line = 1;
  while (i < n) {
    const rowLine = line;
    const row: string[] = [];
    // Read one record.
    for (;;) {
      let cell = '';
      if (text[i] === '"') {
        i++;
        let closed = false;
        let start = i;
        while (i < n) {
          const q = text.indexOf('"', i);
          if (q === -1) {
            i = n;
            break;
          }
          cell += text.slice(start, q);
          for (let k = i; k < q; k++) if (text.charCodeAt(k) === 10) line++;
          if (text[q + 1] === '"') {
            cell += '"';
            i = q + 2;
            start = i;
            continue;
          }
          i = q + 1;
          closed = true;
          break;
        }
        if (!closed) {
          cell += text.slice(start, n);
          for (let k = start; k < n; k++) if (text.charCodeAt(k) === 10) line++;
          state.unterminatedQuote = true;
          i = n;
        }
        // Text after the closing quote up to the separator is kept as is (lenient).
        const rest = readPlain(text, i, delim);
        cell += rest.value;
        i = rest.end;
      } else {
        const r = readPlain(text, i, delim);
        cell = r.value;
        i = r.end;
      }
      row.push(cell);
      const c = text[i];
      if (c === delim) {
        i++;
        if (i >= n) {
          row.push('');
          break;
        }
        continue;
      }
      if (c === '\r') {
        i += text[i + 1] === '\n' ? 2 : 1;
        line++;
        break;
      }
      if (c === '\n') {
        i++;
        line++;
        break;
      }
      break; // end of input
    }
    // A line holding only one empty cell is a blank line, not a record.
    if (!(row.length === 1 && row[0] === '')) yield { cells: row, line: rowLine };
  }
}

export function parseCsv(input: string, delimiter?: Delimiter): CsvResult {
  const text = stripBom(input);
  const delim = delimiter ?? detectDelimiter(text);
  const state = { unterminatedQuote: false };
  const rows: string[][] = [];
  const lines: number[] = [];
  for (const r of records(text, delim, state)) {
    rows.push(r.cells);
    lines.push(r.line);
  }
  return { rows, lines, delimiter: delim, unterminatedQuote: state.unterminatedQuote };
}

/**
 * Same result as `parseCsv`, read in slices of `sliceRows` records with a pause between them so
 * a very large file does not freeze the page. Rejects with `Error('cancelled')` when aborted.
 */
export async function parseCsvAsync(input: string, options: { delimiter?: Delimiter; sliceRows?: number; signal?: AbortSignal } = {}): Promise<CsvResult> {
  const text = stripBom(input);
  const delim = options.delimiter ?? detectDelimiter(text);
  const slice = options.sliceRows ?? 2000;
  const state = { unterminatedQuote: false };
  const rows: string[][] = [];
  const lines: number[] = [];
  for (const r of records(text, delim, state)) {
    rows.push(r.cells);
    lines.push(r.line);
    if (rows.length % slice === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      if (options.signal?.aborted) throw new Error('cancelled');
    }
  }
  return { rows, lines, delimiter: delim, unterminatedQuote: state.unterminatedQuote };
}

function readPlain(text: string, from: number, delim: string): { value: string; end: number } {
  let i = from;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === delim || c === '\n' || c === '\r') break;
    i++;
  }
  return { value: text.slice(from, i), end: i };
}
