import type { DocumentStore } from '../core/doc-store';
import { HistoryRecorder } from '../core/history/recorder';
import { historyStore } from '../core/history/store';

export { historyStore };

/**
 * Set by `HistoryHost`: the recorder once this tab holds the writer lock (null in tabs that do not
 * record), and the document store. `offset` shifts the clock the log uses; only tests set it.
 */
export const runtime: { recorder: HistoryRecorder | null; store: DocumentStore | null; offset: number } = { recorder: null, store: null, offset: 0 };

export const clock = (): number => Date.now() + runtime.offset;
