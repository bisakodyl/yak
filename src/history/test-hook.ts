import { testMode } from '../core/test-build';
import { collection, createRecord, updateRecord } from '../core/schema';
import { testDocId } from '../core/test-ids';
import { historyStore, runtime } from './runtime';

/** Only with `?test` in the URL: lets the browser e2e write the log now, shift its clock, and change many entries at once. */
if (testMode()) {
  const time = (spaceId: string) => {
    const doc = runtime.store?.get(testDocId(runtime.store, `space/${spaceId}/time`));
    if (!doc) throw new Error(`time document of ${spaceId} not open`);
    return doc;
  };
  (window as unknown as { __history: unknown }).__history = {
    flush: async () => runtime.recorder?.flushAll(),
    count: async (docId: string) => (await historyStore.list(docId)).length,
    docIds: () => historyStore.docIds(),
    setOffset: (ms: number) => {
      runtime.offset = ms;
    },
    /** `n` finished entries that started 30 days ago. */
    addEntries: (spaceId: string, n: number, prefix: string) => {
      const doc = time(spaceId);
      const start = new Date(Date.now() - 30 * 86_400_000);
      for (let i = 0; i < n; i++) {
        createRecord(doc, 'time_entries', {
          start: start.toISOString(),
          stop: new Date(start.getTime() + 1_800_000).toISOString(),
          duration: 1800,
          description: `${prefix} ${i}`,
          project_id: null,
          task_id: null,
          tags: [],
          billable: false,
          device_id: 'test-device',
          created_at: start.toISOString(),
          updated_at: start.toISOString(),
          deleted: false,
        });
      }
    },
    deleteEntries: (spaceId: string, prefix: string) => {
      const doc = time(spaceId);
      collection(doc, 'time_entries').forEach((rec, id) => {
        if (String(rec.get('description')).startsWith(prefix) && rec.get('deleted') !== true) updateRecord(doc, 'time_entries', id, { deleted: true, deleted_at: new Date().toISOString() });
      });
    },
    renameEntries: (spaceId: string, prefix: string, to: string) => {
      const doc = time(spaceId);
      collection(doc, 'time_entries').forEach((rec, id) => {
        if (String(rec.get('description')).startsWith(prefix)) updateRecord(doc, 'time_entries', id, { description: to });
      });
    },
    entries: (spaceId: string) => Object.values(time(spaceId).getMap('time_entries').toJSON()),
  };
}
