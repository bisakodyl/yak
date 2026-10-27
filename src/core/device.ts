import { STORAGE_PREFIX } from '../constants';
import { uuid } from './ids';

const KEY = `${STORAGE_PREFIX}-device-id`;

/** This browser profile's device id, created once and kept in localStorage. */
export function deviceId(): string {
  try {
    const existing = localStorage.getItem(KEY);
    if (existing) return existing;
    const created = uuid();
    localStorage.setItem(KEY, created);
    return created;
  } catch {
    return uuid();
  }
}
