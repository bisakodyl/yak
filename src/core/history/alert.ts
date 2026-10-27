import type { BatchAlert } from './watch';

const KEY = 'app-history-alert';
const listeners = new Set<() => void>();

function read(): BatchAlert | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? (JSON.parse(text) as BatchAlert) : null;
  } catch {
    return null;
  }
}

let current: BatchAlert | null = read();

/** The batch alert waiting for a look, kept on this device until dismissed (it survives a reload). */
export function currentAlert(): BatchAlert | null {
  return current;
}

export function raiseAlert(alert: BatchAlert): void {
  current = alert;
  try {
    localStorage.setItem(KEY, JSON.stringify(alert));
  } catch {
    // The alert still shows for this page's lifetime.
  }
  for (const l of listeners) l();
}

export function dismissAlert(): void {
  current = null;
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
  for (const l of listeners) l();
}

export function onAlert(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
