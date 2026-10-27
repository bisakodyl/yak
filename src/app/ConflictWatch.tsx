import { useEffect } from 'preact/hooks';
import type * as Y from 'yjs';
import { watchConflicts } from '../core/conflicts';
import { addNotice } from '../core/notices';
import type { CollectionName } from '../core/schema';
import { useApp } from './context';

const SHARED: CollectionName[] = ['projects', 'clients', 'tags', 'notes'];

function show(v: unknown): string {
  if (typeof v === 'string') return v === '' ? '(empty)' : `“${v.length > 60 ? `${v.slice(0, 60)}…` : v}”`;
  return JSON.stringify(v) ?? String(v);
}

/** Always mounted: turns a concurrent edit of one field that lost on this device into a notice. */
export function ConflictWatch() {
  const { spaceDocs, privateDocs } = useApp();
  useEffect(() => {
    const stops: (() => void)[] = [];
    const attach = (docs: ReadonlyMap<string, Y.Doc>, part: 'shared' | 'private', collections: CollectionName[]): void => {
      for (const [spaceId, doc] of docs) {
        for (const collection of collections) {
          stops.push(
            watchConflicts(doc, collection, (c) =>
              addNotice({
                key: `field-conflict:${spaceId}:${c.id}`,
                kind: 'field-conflict',
                text: `${c.label ? `“${c.label}”: ` : ''}${c.field} was changed on two devices at once. Kept ${show(c.theirs)}; this device had ${show(c.mine)}.`,
                spaceId,
                conflict: { part, collection, recordId: c.recordId, field: c.field, mine: c.mine, theirs: c.theirs },
              }),
            ),
          );
        }
      }
    };
    attach(spaceDocs, 'shared', SHARED);
    attach(privateDocs, 'private', ['time_entries']);
    return () => stops.forEach((s) => s());
  }, [spaceDocs, privateDocs]);
  return null;
}
