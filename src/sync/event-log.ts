export interface LogEntry {
  /** Milliseconds since the epoch. */
  at: number;
  kind: string;
  detail: string;
  /** The space this event is about; it goes to that space's log, not the account's. */
  space?: string;
  /** How many times this event happened; set on errors, which repeat. */
  count?: number;
}

/** Distinct errors remembered for de-duplication; the oldest is forgotten first. */
export const ERROR_KEYS_MAX = 50;
const STACK_LINES = 4;
const DETAIL_MAX = 600;

/** A short, single-string description of a thrown value: message, then the first stack lines. */
function describeError(error: unknown): { message: string; stack: string } {
  if (error instanceof Error) {
    const stack = (error.stack ?? '').split('\n').slice(1, 1 + STACK_LINES).map((l) => l.trim()).join(' | ');
    return { message: `${error.name}: ${error.message}`, stack };
  }
  return { message: String(error), stack: '' };
}

/**
 * Bounded in-memory log of connection events. The app must record every disconnect with its
 * likely cause (lid close, sleep, Wi-Fi change, background tab), so page lifecycle and
 * network events are logged beside the peer connection's own state changes.
 */
export class EventLog {
  private readonly entries: LogEntry[] = [];
  private readonly listeners = new Set<(entry: LogEntry) => void>();

  constructor(
    private readonly capacity = 500,
    private readonly now: () => number = () => Date.now(),
  ) {}

  log(kind: string, detail = '', space?: string): LogEntry {
    const entry: LogEntry = { at: this.now(), kind, detail, ...(space ? { space } : {}) };
    this.entries.push(entry);
    if (this.entries.length > this.capacity) this.entries.shift();
    for (const listener of this.listeners) listener(entry);
    return entry;
  }

  private readonly errors = new Map<string, LogEntry>();

  /**
   * Record an error with the app version and page. The same error again does not add a line: it raises
   * `count` on the first one and tells the listeners, which update their copy.
   */
  logError(kind: string, error: unknown, context: { version?: string; page?: string } = {}): LogEntry {
    const { message, stack } = describeError(error);
    const key = `${kind}|${message}|${stack}`;
    const seen = this.errors.get(key);
    if (seen) {
      seen.count = (seen.count ?? 1) + 1;
      seen.at = this.now();
      this.errors.delete(key);
      this.errors.set(key, seen);
      for (const listener of this.listeners) listener(seen);
      return seen;
    }
    const where = [context.version ? `v${context.version}` : '', context.page ?? ''].filter(Boolean).join(' ');
    const detail = [message, where && `(${where})`, stack].filter(Boolean).join(' ').slice(0, DETAIL_MAX);
    const entry = this.log(kind, detail);
    entry.count = 1;
    this.errors.set(key, entry);
    if (this.errors.size > ERROR_KEYS_MAX) this.errors.delete(this.errors.keys().next().value as string);
    return entry;
  }

  all(): readonly LogEntry[] {
    return this.entries;
  }

  subscribe(listener: (entry: LogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Plain-text export for pasting into notes; contains no addresses or device names. */
  toText(): string {
    return this.entries
      .map((e) => `${new Date(e.at).toISOString()} ${e.kind}${e.detail ? ' ' + e.detail : ''}${e.count && e.count > 1 ? ` (x${e.count})` : ''}`)
      .join('\n');
  }
}

/** Log browser events that explain why a connection may have dropped. Returns a cleanup function. */
export function watchEnvironment(log: EventLog, target: Window = window): () => void {
  const doc = target.document;
  const on = <K extends keyof WindowEventMap>(type: K, fn: () => void): (() => void) => {
    target.addEventListener(type, fn);
    return () => target.removeEventListener(type, fn);
  };
  const stops = [
    on('online', () => {
      log.log('network', 'online');
    }),
    on('offline', () => {
      log.log('network', 'offline');
    }),
    on('pagehide', () => {
      log.log('page', 'pagehide');
    }),
    on('pageshow', () => {
      log.log('page', 'pageshow');
    }),
  ];
  const onVisibility = (): void => {
    log.log('page', `visibility ${doc.visibilityState}`);
  };
  doc.addEventListener('visibilitychange', onVisibility);
  const onFreeze = (): void => {
    log.log('page', 'freeze');
  };
  const onResume = (): void => {
    log.log('page', 'resume');
  };
  doc.addEventListener('freeze', onFreeze);
  doc.addEventListener('resume', onResume);
  const connection = (target.navigator as Navigator & { connection?: EventTarget }).connection;
  const onConnectionChange = (): void => {
    log.log('network', 'connection-change');
  };
  connection?.addEventListener('change', onConnectionChange);
  return () => {
    for (const stop of stops) stop();
    doc.removeEventListener('visibilitychange', onVisibility);
    doc.removeEventListener('freeze', onFreeze);
    doc.removeEventListener('resume', onResume);
    connection?.removeEventListener('change', onConnectionChange);
  };
}
