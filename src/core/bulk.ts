import * as Y from 'yjs';

/**
 * Transaction origin of an edit that changes many records on purpose (rename a tag everywhere, move
 * entries to another project). The history watch ignores it, so it raises no "many changed" warning.
 */
export const BULK_EDIT = 'bulk-edit';

const ROOT_MAPS = ['time_entries', 'projects', 'clients', 'tags', 'notes', 'hidden_tags', 'folders'];

/** Run `tx` for each change so it carries the bulk-edit origin: `run(tx => tx(doc, () => …))`. */
export type BulkTx = (doc: Y.Doc, change: () => void) => void;

export interface BulkResult<T> {
  result: T;
  /** Reverses everything the edit changed in `docs`, in one step per document. Safe to call once. */
  undo(): void;
}

/**
 * One bulk edit across `docs`: everything done through `tx` is one Undo. The undo manager only tracks
 * this edit's origin, so other edits made meanwhile (by this device or by sync) are left alone.
 */
export function bulkEdit<T>(docs: readonly Y.Doc[], run: (tx: BulkTx) => T): BulkResult<T> {
  const unique = [...new Set(docs)];
  const managers = new Map(
    unique.map((doc) => {
      // Root maps that exist only once something reads them would be outside the undo scope.
      for (const name of ROOT_MAPS) doc.getMap(name);
      return [doc, new Y.UndoManager([...doc.share.values()], { trackedOrigins: new Set([BULK_EDIT]), captureTimeout: 0 })] as const;
    }),
  );
  const result = run((doc, change) => doc.transact(change, BULK_EDIT));
  let undone = false;
  return {
    result,
    undo: () => {
      if (undone) return;
      undone = true;
      for (const m of managers.values()) {
        // Every transaction of the edit is its own stack item; undo them all.
        while (m.undoStack.length > 0) m.undo();
        m.destroy();
      }
    },
  };
}
