import type { MenuItem } from './Popover';

/**
 * Menu items that parts of a page add to its header's "…" menu (a list's Select, an export).
 * Plain state so it needs no DOM; the page header renders it.
 */
type Listener = () => void;

const owners = new Map<symbol, readonly MenuItem[]>();
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

/** Set (or with no items, remove) what `owner` adds to the menu. */
export function setPageMenu(owner: symbol, items: readonly MenuItem[]): void {
  if (items.length === 0) owners.delete(owner);
  else owners.set(owner, items);
  emit();
}

export function pageMenuItems(): readonly MenuItem[] {
  return [...owners.values()].flat();
}

export function subscribePageMenu(l: Listener): () => void {
  listeners.add(l);
  return () => void listeners.delete(l);
}

/** The page's Select toggle: one per page, always in the header so entering select mode moves nothing. */
export interface PageSelect {
  /** Selecting is on: the button reads "Done". */
  active: boolean;
  /** Nothing to select yet. */
  disabled: boolean;
  toggle(): void;
}

let select: { owner: symbol; value: PageSelect } | null = null;

export function setPageSelect(owner: symbol, value: PageSelect | null): void {
  if (value) select = { owner, value };
  else if (select?.owner === owner) select = null;
  else return;
  emit();
}

export function pageSelect(): PageSelect | null {
  return select?.value ?? null;
}
