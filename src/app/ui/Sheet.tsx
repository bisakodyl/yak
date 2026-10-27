import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { cx } from './cx';
import { IconClose } from './icons';

/** Narrow touch screens, where an editor opens in a Sheet instead of inside the page. */
export const SHEET_MEDIA = '(max-width: 40rem) and (pointer: coarse)';

/** Whether a media query matches, following changes. False where `matchMedia` is missing. */
export function useMedia(query: string): boolean {
  const get = (): boolean => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const m = matchMedia(query);
    const on = (): void => setMatches(m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, [query]);
  return matches;
}

/** How far down (px) the handle must be dragged to close the sheet. */
const SWIPE_CLOSE = 80;

export interface SheetProps {
  /** Accessible name. */
  label: string;
  class?: string;
  onClose(): void;
  children: ComponentChildren;
}

/**
 * A modal panel along the bottom of the screen, for phones. A native modal `<dialog>`, so focus
 * stays inside and Escape closes it. A tap on the backdrop, the Close button or a swipe down on the
 * handle also closes it; focus returns to where it was. Opens when mounted.
 */
export function Sheet({ label, class: extra, onClose, children }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const drag = useRef<{ id: number; y: number } | null>(null);
  useEffect(() => {
    const d = ref.current;
    const back = document.activeElement;
    if (d && !d.open) d.showModal();
    return () => {
      if (back instanceof HTMLElement && back.isConnected) back.focus();
    };
  }, []);
  const offset = (dy: number): void => {
    const d = ref.current;
    if (d) d.style.translate = dy > 0 ? `0 ${dy}px` : '';
  };
  return (
    <dialog
      ref={ref}
      class={cx('sheet', extra)}
      aria-label={label}
      onClose={onClose}
      onCancel={onClose}
      // The dialog has no padding, so a click on the dialog element itself is on the backdrop.
      onClick={(e) => e.target === ref.current && onClose()}
    >
      <div
        class="sheet-handle"
        aria-hidden="true"
        onPointerDown={(e) => {
          drag.current = { id: e.pointerId, y: e.clientY };
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current?.id === e.pointerId) offset(e.clientY - drag.current.y);
        }}
        onPointerUp={(e) => {
          const start = drag.current;
          drag.current = null;
          offset(0);
          if (start?.id === e.pointerId && e.clientY - start.y > SWIPE_CLOSE) onClose();
        }}
        onPointerCancel={() => {
          drag.current = null;
          offset(0);
        }}
      />
      <div class="sheet-body">
        <button type="button" class="dialog-close" aria-label="Close" title="Close" onClick={onClose}>
          <IconClose />
        </button>
        {children}
      </div>
    </dialog>
  );
}
