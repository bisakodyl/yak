import { createContext } from 'preact';
import { useContext } from 'preact/hooks';
import type * as Y from 'yjs';
import type { EventBus } from '../core/bus';
import type { AccountSpace } from '../core/account';
import type { DocumentStore } from '../core/doc-store';
import type { SyncService } from '../sync/sync-service';

export interface AppContextValue {
  store: DocumentStore;
  sync: SyncService;
  bus: EventBus;
  deviceId: string;
  /** The account document: spaces, device names and removals, personal settings. */
  account: Y.Doc;
  accountId: string;
  /** The spaces this device keeps, oldest first, with display names. */
  spaces: AccountSpace[];
  /** Every space of the account, kept here or not. */
  allSpaces: AccountSpace[];
  /** The space shown in the UI. */
  spaceId: string;
  setSpaceId(id: string): void;
  /** The active space's main document. */
  doc: Y.Doc;
  /** Main documents of all spaces, by space id: projects, clients, tags, notes. */
  spaceDocs: ReadonlyMap<string, Y.Doc>;
  /** The active space's time document (`time_entries`). */
  privateDoc: Y.Doc;
  /** Time documents of all spaces, by space id. */
  privateDocs: ReadonlyMap<string, Y.Doc>;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useApp() outside the app');
  return value;
}
