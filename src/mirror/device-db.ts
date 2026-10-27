import { STORAGE_PREFIX } from '../constants';
import { kvDb } from '../core/kv-db';

/**
 * This device's mirror settings in IndexedDB: the folder handle (handles cannot go into
 * localStorage), the spaces left out, and the last pass's state. Never part of a synced document.
 */
export const { kvGet, kvSet } = kvDb(`${STORAGE_PREFIX}-mirror`);
