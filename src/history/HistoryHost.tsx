import { useEffect } from 'preact/hooks';
import { isLogDoc } from '../core/doc-store';
import { addNotice } from '../core/notices';
import { raiseAlert } from '../core/history/alert';
import { HistoryRecorder } from '../core/history/recorder';
import { readThresholds } from '../core/history/settings';
import { thinAll } from '../core/history/thinning';
import { CorruptionWatch } from '../core/history/watch';
import { useApp } from '../app/context';
import { clock, historyStore, runtime } from './runtime';

const LOCK = 'app-history-writer';
/** The log is thinned a while after start, off the first paint. */
const THIN_DELAY_MS = 30_000;

/** Only one tab writes the log, so two open tabs do not record every change twice. */
function whenWriter(): Promise<boolean> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  if (!locks) return Promise.resolve(true);
  return new Promise((resolve) => {
    void locks.request(LOCK, { ifAvailable: true }, (lock) => {
      resolve(lock !== null);
      // Held until the tab closes.
      return lock ? new Promise<void>(() => undefined) : undefined;
    });
  });
}

/** Records the change log of every space document this device keeps, watches for batch damage, and thins old history. */
export function HistoryHost() {
  const { store, account } = useApp();
  useEffect(() => {
    let alive = true;
    const watch = new CorruptionWatch((alert) => {
      raiseAlert(alert);
      if (!alert.local) {
        const parts = [alert.deleted > 0 ? `${alert.deleted} deleted` : '', alert.changed > 0 ? `${alert.changed} changed` : ''].filter(Boolean);
        addNotice({ key: `bulk-change:${alert.docId}:${alert.at}`, kind: 'bulk-change', text: `Another device changed many time entries at once (${parts.join(', ')}). Compare in History if that was not on purpose.`, at: alert.at });
      }
    }, () => readThresholds(account), clock);
    let recorder: HistoryRecorder | null = null;
    let thin: ReturnType<typeof setTimeout> | undefined;
    const attach = (id: string, doc: Parameters<HistoryRecorder['attach']>[1]): void => {
      if (!id.startsWith('space/') || isLogDoc(id)) return;
      void recorder?.attach(id, doc);
      if (id.endsWith('/private')) watch.attach(id, doc);
    };
    let stopOpened = (): void => undefined;
    const flush = (): void => void recorder?.flushAll();
    const onHidden = (): void => {
      if (document.visibilityState === 'hidden') flush();
    };
    void whenWriter().then((writer) => {
      if (!alive || !writer) return;
      recorder = new HistoryRecorder(historyStore, clock);
      runtime.recorder = recorder;
      runtime.store = store;
      for (const [id, doc] of store.opened()) attach(id, doc);
      stopOpened = store.onOpened(attach);
      thin = setTimeout(() => void thinAll(historyStore, clock()), THIN_DELAY_MS);
    });
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('pagehide', flush);
    return () => {
      alive = false;
      clearTimeout(thin);
      stopOpened();
      document.removeEventListener('visibilitychange', onHidden);
      window.removeEventListener('pagehide', flush);
      flush();
      watch.detach();
      recorder?.detachAll();
      runtime.recorder = null;
      runtime.store = null;
    };
  }, [store, account]);
  return null;
}
