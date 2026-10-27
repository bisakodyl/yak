/** Toast queue: plain state and timers, so it is unit tested without a DOM. The host renders it. */

interface ToastAction {
  label: string;
  run(): void;
}

export interface Toast {
  id: number;
  message: string;
  action?: ToastAction;
}

export interface ToastOptions {
  action?: ToastAction;
  /** Milliseconds before it goes away by itself; 0 keeps it until dismissed. */
  timeout?: number;
}

export const DEFAULT_TOAST_MS = 8000;
/** More than this many on screen and the oldest goes first. */
const MAX_SHOWN = 3;

type Listener = (toasts: readonly Toast[]) => void;

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = { set: (fn, ms) => setTimeout(fn, ms), clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) };

export class ToastStore {
  private toasts: Toast[] = [];
  private listeners = new Set<Listener>();
  private handles = new Map<number, unknown>();
  private next = 1;

  constructor(private readonly timers: Timers = realTimers) {}

  /** Show a message; returns a function that dismisses it. */
  show(message: string, options: ToastOptions = {}): () => void {
    const id = this.next++;
    this.toasts = [...this.toasts, { id, message, action: options.action }];
    while (this.toasts.length > MAX_SHOWN) this.dismiss(this.toasts[0]!.id, false);
    const ms = options.timeout ?? DEFAULT_TOAST_MS;
    if (ms > 0) this.handles.set(id, this.timers.set(() => this.dismiss(id), ms));
    this.emit();
    return () => this.dismiss(id);
  }

  /** Run a toast's action once and remove the toast. */
  act(id: number): void {
    const t = this.toasts.find((x) => x.id === id);
    this.dismiss(id);
    t?.action?.run();
  }

  dismiss(id: number, notify = true): void {
    const h = this.handles.get(id);
    if (h !== undefined) this.timers.clear(h);
    this.handles.delete(id);
    const before = this.toasts.length;
    this.toasts = this.toasts.filter((t) => t.id !== id);
    if (notify && this.toasts.length !== before) this.emit();
  }

  current(): readonly Toast[] {
    return this.toasts;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.toasts);
  }
}
