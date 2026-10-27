import { type EntryRecord, startMs } from './entries';

/** Entries of one day that look the same: description, project, tags and billable. */
export interface RepeatGroup {
  key: string;
  /** Newest first; a group of one is a plain row. */
  entries: EntryRecord[];
}

/** What makes two entries "the same work": case and spacing of the description ignored, tag order ignored. */
export function repeatKey(e: Pick<EntryRecord, 'description' | 'project_id' | 'tags' | 'billable' | 'spaceId'>): string {
  const tags = [...e.tags].map((t) => t.toLowerCase()).sort();
  return JSON.stringify([e.description.trim().replace(/\s+/g, ' ').toLowerCase(), e.project_id ?? '', tags, e.billable, e.spaceId ?? '']);
}

/**
 * Collapse repeated entries of one day into groups, placed where their newest entry is. Input
 * order is kept (callers pass newest first); entries inside a group are newest first.
 */
export function groupRepeats(entries: readonly EntryRecord[]): RepeatGroup[] {
  const byKey = new Map<string, RepeatGroup>();
  const out: RepeatGroup[] = [];
  for (const e of entries) {
    const key = repeatKey(e);
    const g = byKey.get(key);
    if (g) g.entries.push(e);
    else {
      const group = { key, entries: [e] };
      byKey.set(key, group);
      out.push(group);
    }
  }
  for (const g of out) g.entries.sort((a, b) => startMs(b) - startMs(a) || (a.id < b.id ? 1 : -1));
  return out;
}
