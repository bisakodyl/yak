import { IdbStore } from './idb-store';
import { MemoryStore } from './memory-store';
import type { SegmentStore } from './types';

/** This device's change log; a memory log when IndexedDB is not available (history then lasts one visit). */
export const historyStore: SegmentStore = typeof indexedDB === 'undefined' ? new MemoryStore() : new IdbStore();
