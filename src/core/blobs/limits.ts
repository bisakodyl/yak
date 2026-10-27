/** Limits for files in notes (decision N-166b). Every number lives here. */

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_UNIT_BYTES = 1024 * 1024 * 1024;
/** Warn when a unit, or the browser's own quota, is this full. */
export const WARN_FRACTION = 0.8;
/** An inline image over this many pixels on its long side gets a smaller display copy. */
export const DISPLAY_MAX_SIDE = 2560;

export const MB = 1024 * 1024;

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < MB) return `${(n / 1024).toFixed(n < 10 * 1024 ? 1 : 0)} KB`;
  if (n < 1024 * MB) return `${(n / MB).toFixed(n < 10 * MB ? 1 : 0)} MB`;
  return `${(n / (1024 * MB)).toFixed(1)} GB`;
}
