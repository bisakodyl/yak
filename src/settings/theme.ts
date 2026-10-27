export type Theme = 'system' | 'light' | 'dark';

const KEY = 'theme';

export function parseTheme(value: unknown): Theme {
  return value === 'light' || value === 'dark' ? value : 'system';
}

/** Device-only: kept in localStorage, never in a document. Storage can be blocked, so every access is guarded. */
export function readTheme(): Theme {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return 'system';
  }
}

/** Set `data-theme` on `<html>`; `system` removes it so the `prefers-color-scheme` rules apply. */
export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function saveTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // The theme still applies for this visit.
  }
  applyTheme(theme);
}
