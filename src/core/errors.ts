/**
 * Where unexpected errors go (docs/architecture.md). Modules call `reportError` for an error they caught
 * but cannot handle; the shell listens and writes it to the debug log, and may tell the person.
 * Without a listener (unit tests) it does nothing.
 */

interface ReportedError {
  /** Short source name: `window`, `promise`, `backup`, ... */
  kind: string;
  error: unknown;
  /** The person should hear about it (a quiet toast); false for errors the page already shows. */
  notify: boolean;
}

type Listener = (e: ReportedError) => void;

let listener: Listener | undefined;

/** The shell sets this once; it returns a function that removes it. */
export function onReportedError(fn: Listener): () => void {
  listener = fn;
  return () => {
    if (listener === fn) listener = undefined;
  };
}

export function reportError(kind: string, error: unknown, notify = false): void {
  try {
    listener?.({ kind, error, notify });
  } catch {
    // Reporting must never throw into the code that failed.
  }
}
