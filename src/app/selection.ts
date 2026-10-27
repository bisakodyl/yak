import { useCallback, useRef, useState } from 'preact/hooks';

/**
 * Selecting many rows, shared by the lists that bulk-edit (time entries, notes, tasks). Pure state
 * changes live here so they can be tested; `useSelection` wraps them for a component.
 */
export interface SelectionState {
  keys: ReadonlySet<string>;
  /** The row a Shift click extends from. */
  anchor: string | null;
}

export const EMPTY_SELECTION: SelectionState = { keys: new Set(), anchor: null };

export interface ClickMods {
  /** Extend from the anchor to this row. */
  shift: boolean;
  /** Ctrl or Cmd: add or remove this row. */
  toggle: boolean;
}

/**
 * A click on a row's checkbox or a modified click on the row. A plain click toggles the row, Shift
 * selects the range from the anchor (in `order`, the rows as shown), and the anchor moves to the
 * clicked row unless a range was taken.
 */
export function clickSelect(state: SelectionState, key: string, order: readonly string[], mods: ClickMods): SelectionState {
  const keys = new Set(state.keys);
  const from = state.anchor !== null ? order.indexOf(state.anchor) : -1;
  const to = order.indexOf(key);
  if (mods.shift && from >= 0 && to >= 0) {
    const [a, b] = from < to ? [from, to] : [to, from];
    if (!mods.toggle) keys.clear();
    for (let i = a; i <= b; i++) keys.add(order[i]!);
    return { keys, anchor: state.anchor };
  }
  if (keys.has(key)) keys.delete(key);
  else keys.add(key);
  return { keys, anchor: key };
}

/** Select or deselect several rows at once (a group of repeats, a day, all). */
export function setMany(state: SelectionState, keys: readonly string[], on: boolean): SelectionState {
  const next = new Set(state.keys);
  for (const k of keys) {
    if (on) next.add(k);
    else next.delete(k);
  }
  return { keys: next, anchor: keys.length ? keys[keys.length - 1]! : state.anchor };
}

/** Drop keys that are no longer shown (an entry deleted elsewhere). */
export function keepOnly(state: SelectionState, present: ReadonlySet<string>): SelectionState {
  let changed = false;
  const keys = new Set<string>();
  for (const k of state.keys) {
    if (present.has(k)) keys.add(k);
    else changed = true;
  }
  return changed ? { keys, anchor: state.anchor !== null && present.has(state.anchor) ? state.anchor : null } : state;
}

export interface SelectionApi {
  keys: ReadonlySet<string>;
  size: number;
  /** Selecting mode: checkboxes show. On while anything is selected, or after "Select". */
  active: boolean;
  has(key: string): boolean;
  click(key: string, order: readonly string[], mods: ClickMods): void;
  setMany(keys: readonly string[], on: boolean): void;
  start(): void;
  clear(): void;
  keepOnly(present: ReadonlySet<string>): void;
}

export function useSelection(): SelectionApi {
  const [state, setState] = useState<SelectionState>(EMPTY_SELECTION);
  const [mode, setMode] = useState(false);
  return {
    keys: state.keys,
    size: state.keys.size,
    active: mode || state.keys.size > 0,
    has: (key) => state.keys.has(key),
    click: useCallback((key, order, mods) => setState((s) => clickSelect(s, key, order, mods)), []),
    setMany: useCallback((keys, on) => setState((s) => setMany(s, keys, on)), []),
    start: useCallback(() => setMode(true), []),
    clear: useCallback(() => {
      setState(EMPTY_SELECTION);
      setMode(false);
    }, []),
    keepOnly: useCallback((present) => setState((s) => keepOnly(s, present)), []),
  };
}

const LONG_PRESS_MS = 500;

/**
 * Touch long press: handlers to spread on a row. Fires `onLong` after `LONG_PRESS_MS` of holding a
 * finger still; the click that follows is swallowed (`suppressClick` returns true once).
 */
export function useLongPress(onLong: () => void): { handlers: Record<string, (e: PointerEvent) => void>; suppressClick(): boolean } {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = (): void => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    handlers: {
      onPointerDown: (e) => {
        if (e.pointerType !== 'touch') return;
        fired.current = false;
        origin.current = { x: e.clientX, y: e.clientY };
        cancel();
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, LONG_PRESS_MS);
      },
      onPointerMove: (e) => {
        const o = origin.current;
        if (o && Math.hypot(e.clientX - o.x, e.clientY - o.y) > 10) cancel();
      },
      onPointerUp: cancel,
      onPointerCancel: cancel,
    },
    suppressClick: () => {
      const was = fired.current;
      fired.current = false;
      return was;
    },
  };
}
