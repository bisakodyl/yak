import type * as Y from 'yjs';
import { type AccountSpace, readSpaces, spacesMap } from '../core/account';
import { keeps, keepsMap } from '../core/keeps';
import { type DocumentStore, privateDocId, spaceDocId } from '../core/doc-store';
import { initSpaceDoc } from '../core/schema';

export interface AccountSnapshot {
  /** The spaces this device keeps and that are not archived: the ones shown in pickers and lists. */
  spaces: AccountSpace[];
  /** Every space of the account, archived or not, kept here or not (the Devices and Settings pages list them). */
  allSpaces: AccountSpace[];
  spaceDocs: ReadonlyMap<string, Y.Doc>;
  privateDocs: ReadonlyMap<string, Y.Doc>;
}

/**
 * The account's spaces and their open documents, kept in step with the account document: a space
 * added or renamed on another device appears here without a reload, and a space this device starts
 * or stops keeping appears or goes. Each change publishes a new snapshot (new Map objects), so views
 * that depend on the maps re-render.
 */
export class AccountState {
  private snapshot: AccountSnapshot = { spaces: [], allSpaces: [], spaceDocs: new Map(), privateDocs: new Map() };
  private readonly listeners = new Set<(s: AccountSnapshot) => void>();
  private refreshing: Promise<void> = Promise.resolve();

  constructor(
    readonly id: string,
    readonly doc: Y.Doc,
    private readonly store: DocumentStore,
    /** This device's id: which spaces it keeps decides what is shown and opened. */
    private readonly deviceId: string,
  ) {
    const changed = (): void => {
      this.refreshing = this.refreshing.then(() => this.refresh());
    };
    spacesMap(doc).observe(changed);
    keepsMap(doc).observe(changed);
  }

  get current(): AccountSnapshot {
    return this.snapshot;
  }

  /** Whether this device keeps the space, read from the account document itself. */
  keepsSpace(spaceId: string): boolean {
    return keeps(this.doc, this.deviceId, spaceId);
  }

  /**
   * Ids of the spaces this device keeps (what it may sync), read from the account document itself:
   * documents of a space that just arrived are opened before the snapshot is published, and sync
   * must accept them at that moment.
   */
  spaceIds(): Set<string> {
    return new Set(readSpaces(this.doc).filter((s) => this.keepsSpace(s.id)).map((s) => s.id));
  }

  subscribe(listener: (s: AccountSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Open the documents of every space this device keeps and publish a snapshot. */
  async refresh(): Promise<void> {
    const allSpaces = readSpaces(this.doc);
    const kept = allSpaces.filter((s) => this.keepsSpace(s.id));
    const spaces = kept.filter((s) => !s.archived);
    const spaceDocs = new Map(this.snapshot.spaceDocs);
    const privateDocs = new Map(this.snapshot.privateDocs);
    for (const s of kept) {
      if (!spaceDocs.has(s.id)) {
        const doc = await this.store.open(spaceDocId(s.id));
        initSpaceDoc(doc);
        spaceDocs.set(s.id, doc);
      }
      if (!privateDocs.has(s.id)) privateDocs.set(s.id, await this.store.open(privateDocId(s.id)));
    }
    for (const id of [...spaceDocs.keys()]) {
      if (!kept.some((s) => s.id === id)) {
        spaceDocs.delete(id);
        privateDocs.delete(id);
      }
    }
    this.snapshot = { spaces, allSpaces, spaceDocs, privateDocs };
    for (const l of this.listeners) l(this.snapshot);
  }
}
