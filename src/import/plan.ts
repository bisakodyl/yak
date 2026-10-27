import type * as Y from 'yjs';
import { collection } from '../core/schema';
import { type CsvResult, parseCsv, parseCsvAsync, stripBom } from './csv';
import { importId } from './fingerprint';
import { mapHeaders, isBlankRow, parseRow, type ColumnMap } from './toggl';
import { dayKeyInZone } from './zone';

/**
 * Turning a parsed CSV into a plan: which entries, clients, projects and tags would be created
 * in a space, and which rows are skipped or wrong. Planning writes nothing; `run.ts` applies it.
 */

/** What the target space already holds, read from its document. */
export interface ExistingData {
  clients: { id: string; name: string }[];
  projects: { id: string; name: string; clientId: string | null }[];
  /** Live tag names. */
  tags: string[];
  /** `import_id` of every entry, deleted ones included (a deleted import is not brought back). */
  importIds: Set<string>;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : '');

/** `doc` is the space's main document; `entriesDoc` its time document (defaults to `doc`). */
export function readExisting(doc: Y.Doc, entriesDoc: Y.Doc = doc): ExistingData {
  const clients: ExistingData['clients'] = [];
  const projects: ExistingData['projects'] = [];
  const tags: string[] = [];
  const importIds = new Set<string>();
  collection(doc, 'clients').forEach((r, id) => {
    if (r.get('deleted') !== true) clients.push({ id, name: text(r.get('name')) });
  });
  collection(doc, 'projects').forEach((r, id) => {
    if (r.get('deleted') !== true) projects.push({ id, name: text(r.get('name')), clientId: typeof r.get('client_id') === 'string' ? (r.get('client_id') as string) : null });
  });
  collection(doc, 'tags').forEach((r) => {
    if (r.get('deleted') !== true && text(r.get('name'))) tags.push(text(r.get('name')));
  });
  collection(entriesDoc, 'time_entries').forEach((r) => {
    const id = r.get('import_id');
    if (typeof id === 'string') importIds.add(id);
  });
  return { clients, projects, tags, importIds };
}

interface PlannedEntry {
  line: number;
  start: string;
  stop: string;
  duration: number;
  description: string;
  /** Key into `ImportPlan.projects`, or null for an entry without a project. */
  projectKey: string | null;
  tags: string[];
  billable: boolean;
  importId: string;
}

interface PlannedClient {
  name: string;
  /** Set when the client already exists. */
  existingId: string | null;
}

interface PlannedProject {
  name: string;
  /** Key into `ImportPlan.clients`, or null. */
  clientKey: string | null;
  existingId: string | null;
}

interface RowError {
  line: number;
  message: string;
}

export interface ImportPlan {
  /** Entries that would be created, in file order. */
  entries: PlannedEntry[];
  clients: Map<string, PlannedClient>;
  projects: Map<string, PlannedProject>;
  newClients: number;
  newProjects: number;
  /** Tag names to create (spelling as first seen in the file). */
  newTags: string[];
  rowsRead: number;
  duplicatesInFile: number;
  duplicatesExisting: number;
  errorCount: number;
  /** The first errors, for display. */
  errors: RowError[];
  totalSeconds: number;
  /** First and last local start day (`YYYY-MM-DD`) in the chosen zone among the entries to create. */
  firstDay: string | null;
  lastDay: string | null;
  /** Plain-language notes that do not stop the import. */
  warnings: string[];
  /** Problems with the file as a whole; when present nothing can be imported. */
  fileProblems: string[];
  recognisedColumns: string[];
  ignoredColumns: string[];
}

const MAX_LISTED_ERRORS = 100;

function emptyPlan(): ImportPlan {
  return {
    entries: [],
    clients: new Map(),
    projects: new Map(),
    newClients: 0,
    newProjects: 0,
    newTags: [],
    rowsRead: 0,
    duplicatesInFile: 0,
    duplicatesExisting: 0,
    errorCount: 0,
    errors: [],
    totalSeconds: 0,
    firstDay: null,
    lastDay: null,
    warnings: [],
    fileProblems: [],
    recognisedColumns: [],
    ignoredColumns: [],
  };
}

export interface ParsedFile {
  header: string[];
  map: ColumnMap;
  /** Data rows (blank ones removed) and the line each starts on. */
  rows: string[][];
  lines: number[];
  fileProblems: string[];
  recognisedColumns: string[];
  ignoredColumns: string[];
  warnings: string[];
}

/** Parse the text of a CSV file far enough to know its columns and rows. */
export function parseTogglFile(content: string): ParsedFile {
  return fileFromCsv(parseCsv(stripBom(content)));
}

/** Like `parseTogglFile`, in slices so a very large file does not freeze the page. */
export async function parseTogglFileAsync(content: string): Promise<ParsedFile> {
  return fileFromCsv(await parseCsvAsync(stripBom(content)));
}

function fileFromCsv(csv: CsvResult): ParsedFile {
  const out: ParsedFile = { header: [], map: {}, rows: [], lines: [], fileProblems: [], recognisedColumns: [], ignoredColumns: [], warnings: [] };
  const header = csv.rows[0];
  if (!header) {
    out.fileProblems.push('The file is empty.');
    return out;
  }
  const info = mapHeaders(header);
  out.header = header;
  out.map = info.map;
  out.recognisedColumns = info.recognised;
  out.ignoredColumns = info.ignored;
  out.fileProblems = info.problems;
  if (info.recognised.length === 0) out.fileProblems.unshift('None of the column headings look like a Toggl Detailed report export.');
  for (let i = 1; i < csv.rows.length; i++) {
    const row = csv.rows[i] as string[];
    if (isBlankRow(row)) continue;
    out.rows.push(row);
    out.lines.push(csv.lines[i] as number);
  }
  if (csv.unterminatedQuote) out.warnings.push('The file ends inside a quoted cell; the last row may be cut off.');
  return out;
}

export interface PlanOptions {
  zone: string;
  signal?: AbortSignal;
  /** Called with the share of rows done, 0 to 1. */
  onProgress?: (fraction: number) => void;
  /** Rows between yields to the browser. */
  sliceRows?: number;
}

const yieldToBrowser = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
const lower = (s: string): string => s.trim().toLowerCase();
const projectKeyOf = (client: string, project: string): string => `${lower(client)}\u0000${lower(project)}`;

export class PlanAborted extends Error {
  constructor() {
    super('Planning was cancelled');
  }
}

/**
 * Work out what importing `file` into a space holding `existing` would do. Long files are
 * handled in slices with a yield between them so the page stays responsive.
 */
export async function buildPlan(file: ParsedFile, existing: ExistingData, options: PlanOptions): Promise<ImportPlan> {
  const plan = emptyPlan();
  plan.fileProblems = [...file.fileProblems];
  plan.recognisedColumns = file.recognisedColumns;
  plan.ignoredColumns = file.ignoredColumns;
  plan.warnings = [...file.warnings];
  plan.rowsRead = file.rows.length;
  if (file.fileProblems.length > 0) return plan;

  // Existing records by name, so the first match wins and an archived record still matches.
  const clientByName = new Map<string, string>();
  const clientNameById = new Map<string, string>();
  for (const c of existing.clients) {
    clientNameById.set(c.id, c.name);
    if (!clientByName.has(lower(c.name))) clientByName.set(lower(c.name), c.id);
  }
  const projectByKey = new Map<string, string>();
  for (const p of existing.projects) {
    const key = projectKeyOf(p.clientId ? (clientNameById.get(p.clientId) ?? '') : '', p.name);
    if (!projectByKey.has(key)) projectByKey.set(key, p.id);
  }
  const tagNames = new Map<string, string>();
  for (const t of existing.tags) if (!tagNames.has(lower(t))) tagNames.set(lower(t), t);
  const newTags: string[] = [];

  const seen = new Set<string>();
  const people = new Set<string>();
  let rowsWithTask = 0;
  let mismatches = 0;
  const slice = options.sliceRows ?? 1000;
  let firstMs = Infinity;
  let lastMs = -Infinity;

  for (let i = 0; i < file.rows.length; i++) {
    if (i > 0 && i % slice === 0) {
      options.onProgress?.(i / file.rows.length);
      await yieldToBrowser();
      if (options.signal?.aborted) throw new PlanAborted();
    }
    const cells = file.rows[i] as string[];
    const line = file.lines[i] as number;
    const result = parseRow(cells, file.map, options.zone, line);
    if (!result.ok) {
      plan.errorCount++;
      if (plan.errors.length < MAX_LISTED_ERRORS) plan.errors.push({ line, message: result.error });
      continue;
    }
    const row = result.row;
    if (row.person) people.add(lower(row.person));
    if (row.task) rowsWithTask++;
    if (row.durationMismatch) mismatches++;

    const start = new Date(row.start).toISOString();
    const stop = new Date(row.stop).toISOString();
    const id = importId({ start, stop, description: row.description, project: row.project, client: row.client });
    if (seen.has(id)) {
      plan.duplicatesInFile++;
      continue;
    }
    seen.add(id);
    if (existing.importIds.has(id)) {
      plan.duplicatesExisting++;
      continue;
    }

    // Client and project: match existing by name, otherwise plan to create.
    let projectKey: string | null = null;
    if (row.project) {
      projectKey = projectKeyOf(row.client, row.project);
      if (!plan.projects.has(projectKey)) {
        let clientKey: string | null = null;
        if (row.client) {
          clientKey = lower(row.client);
          if (!plan.clients.has(clientKey)) {
            const existingId = clientByName.get(clientKey) ?? null;
            plan.clients.set(clientKey, { name: row.client, existingId });
            if (!existingId) plan.newClients++;
          }
        }
        const existingId = projectByKey.get(projectKey) ?? null;
        plan.projects.set(projectKey, { name: row.project, clientKey, existingId });
        if (!existingId) plan.newProjects++;
      }
    }

    const tags: string[] = [];
    for (const t of row.tags) {
      let name = tagNames.get(lower(t));
      if (!name) {
        name = t;
        tagNames.set(lower(t), t);
        newTags.push(t);
      }
      tags.push(name);
    }

    plan.entries.push({
      line,
      start,
      stop,
      duration: Math.round((row.stop - row.start) / 1000),
      description: row.description,
      projectKey,
      tags,
      billable: row.billable,
      importId: id,
    });
    plan.totalSeconds += Math.round((row.stop - row.start) / 1000);
    if (row.start < firstMs) firstMs = row.start;
    if (row.start > lastMs) lastMs = row.start;
  }
  options.onProgress?.(1);

  plan.newTags = newTags;
  if (plan.entries.length > 0) {
    plan.firstDay = dayKeyInZone(options.zone, firstMs);
    plan.lastDay = dayKeyInZone(options.zone, lastMs);
  }
  if (people.size > 1) plan.warnings.push(`The file has entries from ${people.size} different people. All of them will be imported as yours.`);
  if (rowsWithTask > 0) plan.warnings.push(`${rowsWithTask} row${rowsWithTask === 1 ? ' has' : 's have'} a Task. Task names are not imported.`);
  if (mismatches > 0) {
    plan.warnings.push(
      `${mismatches} row${mismatches === 1 ? '' : 's'} where the start and end do not match the Duration by more than a minute. The time zone may be wrong; the stored length follows the start and end.`,
    );
  }
  return plan;
}
