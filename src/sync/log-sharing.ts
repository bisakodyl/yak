import { STORAGE_PREFIX } from '../constants';

/**
 * Whether this device writes to the shared debug log (docs/decisions/sync.md). A per-device choice kept
 * in localStorage, never in a synced document; on by default during the alpha.
 */

const SHARING_KEY = `${STORAGE_PREFIX}-debug-log-sharing`;

const listeners = new Set<(on: boolean) => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Without storage the choice lasts until the page closes only.
  }
}

let memory: boolean | undefined;

export function logSharingOn(): boolean {
  return memory ?? read(SHARING_KEY) !== 'off';
}

export function setLogSharing(on: boolean): void {
  memory = on;
  write(SHARING_KEY, on ? 'on' : 'off');
  for (const l of listeners) l(on);
}

export function onLogSharingChange(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
