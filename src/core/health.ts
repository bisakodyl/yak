/**
 * Data health: what modules tell the shell about the safety of the data on this device (a stale
 * backup, a sync problem), so the shell can show one status dot without importing a feature module.
 * A source reports its current items whenever they change and an empty list when all is well.
 * Kept in memory only: every source recomputes it at start-up.
 */
export interface HealthItem {
  /** `warn` turns the dot amber; `info` is listed in the panel only. */
  level: 'warn' | 'info';
  text: string;
}

const sources = new Map<string, readonly HealthItem[]>();
const listeners = new Set<() => void>();
let snapshot: readonly HealthItem[] = [];

function rebuild(): void {
  snapshot = [...sources.values()].flat();
  for (const l of listeners) l();
}

/** Sets what `source` reports; an empty list clears it. */
export function reportHealth(source: string, items: readonly HealthItem[]): void {
  const before = JSON.stringify(sources.get(source) ?? []);
  if (before === JSON.stringify(items)) return;
  if (items.length === 0) sources.delete(source);
  else sources.set(source, items);
  rebuild();
}

export function healthItems(): readonly HealthItem[] {
  return snapshot;
}

export function onHealth(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function resetHealth(): void {
  sources.clear();
  rebuild();
}
