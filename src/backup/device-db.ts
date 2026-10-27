import { STORAGE_PREFIX } from '../constants';
import { kvDb } from '../core/kv-db';

/**
 * This device's backup settings in IndexedDB: the folder handle (handles cannot go into
 * localStorage) and data kept for a replace restore. Never part of a synced document.
 */
export const { kvGet, kvSet } = kvDb(`${STORAGE_PREFIX}-backup`);
