/** A tiny typed event bus: the only way modules talk to each other besides the documents. */
export type BusEvents = {
  /** A time entry started or stopped; backups listen for `stopped`. */
  'timer:started': { spaceId: string; entryId: string };
  'timer:stopped': { spaceId: string; entryId: string };
  /** Ask the notes module to open a note. */
  'notes:open': { spaceId: string; noteId: string };
  /** Ask the time module to start a timer (for example from a task); it applies the running-timer rule. */
  'timer:start-request': { spaceId: string; description: string; taskId?: string; projectId?: string; tags?: string[] };
  /** A backup was merged or replaced into these documents; the app adopts a restored account if needed. */
  'backup:restored': { docIds: string[] };
  /** The account's passphrase was just typed (set or entered) on this device: the account key is sealed with it, once, and it is not kept (src/app/account-keys-runtime.ts). */
  'passphrase:ready': { passphrase: string };
};

type Handler<T> = (payload: T) => void;

export class EventBus {
  private readonly handlers = new Map<keyof BusEvents, Set<Handler<never>>>();

  on<K extends keyof BusEvents>(event: K, handler: Handler<BusEvents[K]>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler as Handler<never>);
    return () => set?.delete(handler as Handler<never>);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]): void {
    for (const h of this.handlers.get(event) ?? []) (h as Handler<BusEvents[K]>)(payload);
  }
}

export const bus = new EventBus();
