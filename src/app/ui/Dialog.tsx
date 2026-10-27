import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { cx } from './cx';
import { IconClose } from './icons';

export interface DialogProps {
  /** Accessible name. */
  label: string;
  class?: string;
  onClose(): void;
  children: ComponentChildren;
}

/**
 * A modal dialog with a visible Close button, so it can be dismissed on a phone, which has no Escape
 * key. Escape and a click on the close button both call `onClose`. Opens when mounted.
 */
export function Dialog({ label, class: extra, onClose, children }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog ref={ref} class={cx('dialog', extra)} aria-label={label} onClose={onClose} onCancel={onClose}>
      <button type="button" class="dialog-close" aria-label="Close" title="Close" onClick={onClose}>
        <IconClose />
      </button>
      {children}
    </dialog>
  );
}
