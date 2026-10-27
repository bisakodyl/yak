import { STORAGE_PREFIX } from '../constants';
import type { StorageLike } from '../core/account-setup';

/**
 * A share link opened on a device that is not set up yet (F-324): the code is remembered while the
 * person starts a space or creates a passphrase, so the join can carry on. Links last 15 minutes.
 */
const KEY = `${STORAGE_PREFIX}-pending-share`;
const LIFETIME_MS = 15 * 60_000;

export function rememberShare(storage: StorageLike, code: string, now = Date.now()): void {
  try {
    const old = JSON.parse(storage.getItem(KEY) ?? 'null') as { code?: unknown; at?: unknown } | null;
    // The same link keeps its first time, so it still expires with the link.
    const at = old && old.code === code && typeof old.at === 'number' ? old.at : now;
    storage.setItem(KEY, JSON.stringify({ code, at }));
  } catch {
    // Storage unavailable: the address still carries the link.
  }
}

export function pendingShare(storage: StorageLike, now = Date.now()): string | undefined {
  try {
    const v = JSON.parse(storage.getItem(KEY) ?? 'null') as { code?: unknown; at?: unknown } | null;
    return v && typeof v.code === 'string' && typeof v.at === 'number' && now - v.at < LIFETIME_MS ? v.code : undefined;
  } catch {
    return undefined;
  }
}

export function forgetShare(storage: StorageLike): void {
  try {
    storage.setItem(KEY, '');
  } catch {
    // ignore
  }
}
