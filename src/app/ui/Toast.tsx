import { useEffect, useState } from 'preact/hooks';
import { Button, IconButton } from './Button';
import { IconClose } from './icons';
import { type ToastOptions, ToastStore } from './toast-store';

/** The app's one toast queue; App renders <ToastHost /> once. */
export const toasts = new ToastStore();

/** Show a brief message, optionally with one action such as Undo. Returns a function that dismisses it. */
export function toast(message: string, options?: ToastOptions): () => void {
  return toasts.show(message, options);
}

/** Renders the queue. The live region is always present so screen readers announce new toasts. */
export function ToastHost({ store = toasts }: { store?: ToastStore }) {
  const [list, setList] = useState(store.current());
  useEffect(() => {
    setList(store.current());
    return store.subscribe(setList);
  }, [store]);
  return (
    <div class="toasts" role="status" aria-live="polite">
      {list.map((t) => (
        <div key={t.id} class="toast">
          <span class="toast-text">{t.message}</span>
          {t.action && <Button onClick={() => store.act(t.id)}>{t.action.label}</Button>}
          <IconButton label="Dismiss" icon={<IconClose />} onClick={() => store.dismiss(t.id)} />
        </div>
      ))}
    </div>
  );
}
