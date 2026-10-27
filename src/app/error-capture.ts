import { onReportedError, reportError } from '../core/errors';
import type { EventLog } from '../sync/event-log';

/** At most one "Something went wrong" toast in this long, however many errors arrive. */
export const TOAST_EVERY_MS = 10 * 60 * 1000;

export interface ErrorCaptureOptions {
  log: EventLog;
  version: string;
  page(): string;
  /** Show the quiet toast; it offers Report a problem. */
  notify(): void;
  now?(): number;
  target?: Pick<Window, 'addEventListener' | 'removeEventListener'>;
}

/** Send uncaught errors, unhandled rejections and `reportError` calls to the debug log (de-duplicated). Returns a cleanup. */
export function captureErrors(o: ErrorCaptureOptions): () => void {
  const now = o.now ?? (() => Date.now());
  const target = o.target ?? window;
  let lastToast = -Infinity;
  const record = (kind: string, error: unknown, notify: boolean): void => {
    o.log.logError(kind, error, { version: o.version, page: o.page() });
    if (notify && now() - lastToast >= TOAST_EVERY_MS) {
      lastToast = now();
      o.notify();
    }
  };
  const onError = (ev: Event): void => {
    const e = ev as ErrorEvent;
    record('error', e.error ?? e.message, true);
  };
  const onRejection = (ev: Event): void => record('error', (ev as PromiseRejectionEvent).reason, true);
  target.addEventListener('error', onError);
  target.addEventListener('unhandledrejection', onRejection);
  const stop = onReportedError((r) => record(`error:${r.kind}`, r.error, r.notify));
  return () => {
    target.removeEventListener('error', onError);
    target.removeEventListener('unhandledrejection', onRejection);
    stop();
  };
}

export { reportError };
