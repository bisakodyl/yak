import * as Y from 'yjs';
import { uuid } from '../core/ids';
import type { EventLog, LogEntry } from './event-log';

/**
 * The shared debug log (docs/sync.md). Every device appends its connection and sync events to a
 * synced document so any device can show them all: one account log (pairing, links, signaling) and
 * one log per space (only devices that keep the space receive it). Lines hold no note or entry
 * contents. Each device trims only its own lines.
 */

export const LOG_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
/** Hard cap per device and document, so a chatty device cannot grow the log without bound. */
export const LOG_MAX_LINES_PER_DEVICE = 3000;

export interface LogLine {
  at: number;
  device: string;
  kind: string;
  detail: string;
  /** Times an error repeated; absent for ordinary events. */
  count?: number;
}

const LINES = 'lines';

function linesMap(doc: Y.Doc): Y.Map<LogLine> {
  return doc.getMap<LogLine>(LINES);
}

/** Append one line, keyed by a fresh id. */
export function appendLine(doc: Y.Doc, device: string, entry: LogEntry, id: string = uuid()): void {
  const count = entry.count !== undefined && entry.count > 1 ? { count: entry.count } : {};
  linesMap(doc).set(id, { at: entry.at, device, kind: entry.kind, detail: entry.detail, ...count });
}

/** All lines of the given log documents, oldest first. */
export function readLines(docs: readonly Y.Doc[]): LogLine[] {
  const out: LogLine[] = [];
  for (const doc of docs) for (const line of linesMap(doc).values()) out.push(line);
  return out.sort((a, b) => a.at - b.at);
}

/** Remove every line this device wrote to the document. Returns how many went. */
export function removeOwnLines(doc: Y.Doc, device: string): number {
  const mine = [...linesMap(doc).entries()].filter(([, l]) => l.device === device).map(([k]) => k);
  if (mine.length > 0) doc.transact(() => mine.forEach((k) => linesMap(doc).delete(k)));
  return mine.length;
}

/** Remove this device's lines older than the retention, then the oldest beyond the cap. Returns how many went. */
export function trimOwnLines(doc: Y.Doc, device: string, now: number, retentionMs = LOG_RETENTION_MS, max = LOG_MAX_LINES_PER_DEVICE): number {
  const own = [...linesMap(doc).entries()].filter(([, l]) => l.device === device).sort((a, b) => a[1].at - b[1].at);
  const drop = own.filter(([, l]) => now - l.at > retentionMs).map(([k]) => k);
  const rest = own.length - drop.length;
  if (rest > max) for (const [k] of own.filter(([k]) => !drop.includes(k)).slice(0, rest - max)) drop.push(k);
  if (drop.length > 0) doc.transact(() => drop.forEach((k) => linesMap(doc).delete(k)));
  return drop.length;
}

/** Plain text of lines for pasting into a report. */
export function linesToText(lines: readonly LogLine[], label: (device: string) => string): string {
  return lines
    .map((l) => `${new Date(l.at).toISOString()} [${label(l.device)}] ${l.kind}${l.detail ? ' ' + l.detail : ''}${l.count && l.count > 1 ? ` (x${l.count})` : ''}`)
    .join('\n');
}

export interface SharedLogOptions {
  log: EventLog;
  device: string;
  openAccountLog(): Promise<Y.Doc>;
  /** The log document of a space this device keeps, or undefined when it does not keep it. */
  openSpaceLog(spaceId: string): Promise<Y.Doc> | undefined;
  now?(): number;
  /** Whether this device may write now (the person's switch); default always. */
  enabled?(): boolean;
  /** Every log document this device can reach, for clearing its lines when sharing is turned off. */
  allLogs?(): Promise<Y.Doc[]>;
}

/** Copies the local event log into the shared documents, and trims this device's old lines. */
export class SharedLogWriter {
  private stop: (() => void) | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly now: () => number;
  private readonly docs = new Set<Y.Doc>();
  /** The line an entry was written to, so a repeated error updates its line instead of adding one. */
  private readonly lineIds = new WeakMap<LogEntry, string>();

  constructor(private readonly o: SharedLogOptions) {
    this.now = o.now ?? (() => Date.now());
  }

  start(): void {
    for (const e of this.o.log.all()) this.write(e);
    this.stop = this.o.log.subscribe((e) => this.write(e));
    void this.trim();
    this.timer = setInterval(() => void this.trim(), 60 * 60 * 1000);
  }

  close(): void {
    this.stop?.();
    clearInterval(this.timer);
  }

  /** Delete this device's lines from every log document, here and (by sync) on the other devices. */
  async clearOwn(): Promise<void> {
    const docs = new Set<Y.Doc>(this.docs);
    for (const d of (await this.o.allLogs?.()) ?? [await this.o.openAccountLog()]) docs.add(d);
    for (const d of docs) removeOwnLines(d, this.o.device);
  }

  private write(e: LogEntry): void {
    if (this.o.enabled && !this.o.enabled()) return;
    const doc = e.space ? this.o.openSpaceLog(e.space) : this.o.openAccountLog();
    const id = this.lineIds.get(e) ?? uuid();
    this.lineIds.set(e, id);
    void doc
      ?.then((d) => {
        this.docs.add(d);
        appendLine(d, this.o.device, e, id);
      })
      .catch(() => undefined);
  }

  private async trim(): Promise<void> {
    if (this.o.enabled && !this.o.enabled()) return;
    this.docs.add(await this.o.openAccountLog());
    for (const d of this.docs) trimOwnLines(d, this.o.device, this.now());
  }
}
