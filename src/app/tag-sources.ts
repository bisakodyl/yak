import type * as Y from 'yjs';
import type { AppContextValue } from './context';

/**
 * Where a kind of item keeps tags. Time registers its entries, notes its notes and tasks; the tag
 * manager (`views/TagManager.tsx`) lists, renames, merges and removes tags across all sources
 * without importing either module.
 */
export interface TagItem {
  id: string;
  label: string;
  /** Opens the item, when it can be opened. */
  open?(): void;
}

export interface TagSource {
  id: string;
  /** Item nouns for counts: "12 entries · 3 notes". */
  singular: string;
  plural: string;
  /** Documents of the space that rename and remove change, so one Undo covers them. */
  docs(app: AppContextValue, spaceId: string): Y.Doc[];
  /** Tags in use in the space: lower-case name → spelling and item count. */
  tags(app: AppContextValue, spaceId: string): Map<string, { name: string; count: number }>;
  items(app: AppContextValue, spaceId: string, tag: string): TagItem[];
  /** Rename (or merge into an existing tag). Returns how many items changed. */
  rename(app: AppContextValue, spaceId: string, from: string, to: string): number;
  /** Remove the tag from every item. Returns how many items changed. */
  remove(app: AppContextValue, spaceId: string, tag: string): number;
}

const sources: TagSource[] = [];

export function registerTagSource(source: TagSource): void {
  if (!sources.some((s) => s.id === source.id)) sources.push(source);
}

export function allTagSources(): readonly TagSource[] {
  return sources;
}
