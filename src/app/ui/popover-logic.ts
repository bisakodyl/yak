/** Pure helpers for Popover and Menu, kept apart so they can be unit tested without a DOM. */

export interface Box {
  top: number;
  left: number;
  bottom: number;
  right: number;
  width: number;
  height: number;
}

const MARGIN = 8;
const GAP = 4;

/**
 * Where to put a panel under its anchor: below it, or above when there is no room below; aligned
 * to the anchor's start or end; kept inside the viewport with a small margin.
 */
export function placeBelow(anchor: Box, panel: Pick<Box, 'width' | 'height'>, viewport: { width: number; height: number }, align: 'start' | 'end'): { top: number; left: number } {
  const roomBelow = viewport.height - anchor.bottom - GAP - MARGIN;
  const roomAbove = anchor.top - GAP - MARGIN;
  const top = panel.height > roomBelow && roomAbove > roomBelow ? anchor.top - GAP - panel.height : anchor.bottom + GAP;
  const wanted = align === 'end' ? anchor.right - panel.width : anchor.left;
  const left = Math.min(Math.max(wanted, MARGIN), Math.max(MARGIN, viewport.width - MARGIN - panel.width));
  return { top: Math.max(MARGIN, top), left };
}

/**
 * The menu item to focus after a key press: ArrowDown and ArrowUp wrap around, Home and End jump
 * to the ends, disabled items are skipped. Returns `current` for keys the menu does not handle,
 * and -1 when every item is disabled.
 */
export function nextMenuIndex(current: number, key: string, disabled: readonly boolean[]): number {
  const n = disabled.length;
  if (n === 0 || disabled.every(Boolean)) return -1;
  const step = (from: number, dir: 1 | -1): number => {
    let i = from;
    for (let k = 0; k < n; k++) {
      i = (i + dir + n) % n;
      if (!disabled[i]) return i;
    }
    return -1;
  };
  switch (key) {
    case 'ArrowDown':
      return step(current < 0 ? -1 : current, 1);
    case 'ArrowUp':
      return step(current < 0 ? 0 : current, -1);
    case 'Home':
      return step(-1, 1);
    case 'End':
      return step(0, -1);
    default:
      return current;
  }
}
