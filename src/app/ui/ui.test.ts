import { describe, expect, it } from 'vitest';
import { cx } from './cx';
import { nextMenuIndex, placeBelow } from './popover-logic';
import { DEFAULT_TOAST_MS, type Timers, ToastStore } from './toast-store';

describe('cx', () => {
  it('joins truthy names and gives undefined for none', () => {
    expect(cx('primary', false, undefined, 'big')).toBe('primary big');
    expect(cx(false, null, '')).toBeUndefined();
  });
});

describe('placeBelow', () => {
  const box = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const vp = { width: 800, height: 600 };

  it('puts the panel under the anchor, aligned to its start or end', () => {
    expect(placeBelow(box(100, 50, 40, 30), { width: 200, height: 100 }, vp, 'start')).toEqual({ top: 84, left: 100 });
    expect(placeBelow(box(400, 50, 40, 30), { width: 200, height: 100 }, vp, 'end')).toEqual({ top: 84, left: 240 });
  });

  it('flips above when there is no room below, and stays inside the viewport', () => {
    expect(placeBelow(box(100, 520, 40, 30), { width: 200, height: 150 }, vp, 'start')).toEqual({ top: 366, left: 100 });
    expect(placeBelow(box(760, 50, 30, 30), { width: 200, height: 100 }, vp, 'start').left).toBe(592);
    expect(placeBelow(box(2, 50, 30, 30), { width: 200, height: 100 }, vp, 'end').left).toBe(8);
  });
});

describe('nextMenuIndex', () => {
  const none = [false, false, false];

  it('moves with arrows and wraps', () => {
    expect(nextMenuIndex(-1, 'ArrowDown', none)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowDown', none)).toBe(1);
    expect(nextMenuIndex(2, 'ArrowDown', none)).toBe(0);
    expect(nextMenuIndex(0, 'ArrowUp', none)).toBe(2);
    expect(nextMenuIndex(-1, 'ArrowUp', none)).toBe(2);
  });

  it('jumps with Home and End, skips disabled items, ignores other keys', () => {
    const d = [true, false, true, false, true];
    expect(nextMenuIndex(3, 'Home', d)).toBe(1);
    expect(nextMenuIndex(1, 'End', d)).toBe(3);
    expect(nextMenuIndex(1, 'ArrowDown', d)).toBe(3);
    expect(nextMenuIndex(3, 'ArrowDown', d)).toBe(1);
    expect(nextMenuIndex(1, 'a', d)).toBe(1);
    expect(nextMenuIndex(0, 'ArrowDown', [true, true])).toBe(-1);
  });
});

/** Timers driven by hand. */
function fakeTimers() {
  let now = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  let next = 1;
  const timers: Timers = {
    set: (fn, ms) => {
      pending.set(next, { at: now + ms, fn });
      return next++;
    },
    clear: (h) => void pending.delete(h as number),
  };
  const advance = (ms: number): void => {
    now += ms;
    for (const [id, t] of [...pending].sort((a, b) => a[1].at - b[1].at)) {
      if (t.at <= now) {
        pending.delete(id);
        t.fn();
      }
    }
  };
  return { timers, advance, pending };
}

describe('ToastStore', () => {
  it('shows a toast and removes it after the timeout', () => {
    const { timers, advance } = fakeTimers();
    const store = new ToastStore(timers);
    const seen: number[] = [];
    store.subscribe((t) => seen.push(t.length));
    store.show('Saved');
    expect(store.current().map((t) => t.message)).toEqual(['Saved']);
    advance(DEFAULT_TOAST_MS - 1);
    expect(store.current()).toHaveLength(1);
    advance(1);
    expect(store.current()).toHaveLength(0);
    expect(seen).toEqual([1, 0]);
  });

  it('runs the action once and removes the toast; dismiss cancels its timer', () => {
    const { timers, pending } = fakeTimers();
    const store = new ToastStore(timers);
    let undone = 0;
    store.show('Entry deleted', { action: { label: 'Undo', run: () => undone++ } });
    const id = store.current()[0]!.id;
    store.act(id);
    store.act(id);
    expect(undone).toBe(1);
    expect(store.current()).toHaveLength(0);
    expect(pending.size).toBe(0);
    const dismiss = store.show('Again', { timeout: 0 });
    expect(pending.size).toBe(0);
    dismiss();
    expect(store.current()).toHaveLength(0);
  });

  it('keeps at most three, dropping the oldest', () => {
    const { timers, pending } = fakeTimers();
    const store = new ToastStore(timers);
    for (const m of ['a', 'b', 'c', 'd']) store.show(m);
    expect(store.current().map((t) => t.message)).toEqual(['b', 'c', 'd']);
    expect(pending.size).toBe(3);
  });
});
