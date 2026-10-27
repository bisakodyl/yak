import type * as Y from 'yjs';
import { DEFAULT_THRESHOLDS, type Thresholds } from './watch';

/** How many deleted or changed entries make a batch worth a warning; kept in the account's settings. */
const KEYS = { deleted: 'history_deleted', changed: 'history_changed' } as const;

function count(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : fallback;
}

export function readThresholds(account: Y.Doc | undefined): Thresholds {
  const map = account?.getMap<unknown>('settings');
  return { ...DEFAULT_THRESHOLDS, deleted: count(map?.get(KEYS.deleted), DEFAULT_THRESHOLDS.deleted), changed: count(map?.get(KEYS.changed), DEFAULT_THRESHOLDS.changed) };
}

export function writeThreshold(account: Y.Doc, key: 'deleted' | 'changed', value: number): void {
  account.getMap<unknown>('settings').set(KEYS[key], Math.max(1, Math.round(value)));
}
