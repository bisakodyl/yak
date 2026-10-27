import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { bulkEdit } from './bulk';
import { collection, createRecord } from './schema';

describe('bulkEdit', () => {
  it('one Undo reverses every transaction of the edit, also in maps nothing had read yet', () => {
    const d = new Y.Doc();
    const { undo } = bulkEdit([d], (tx) => {
      tx(d, () => void createRecord(d, 'time_entries', { a: 1 }));
      tx(d, () => void createRecord(d, 'time_entries', { a: 2 }));
    });
    expect(collection(d, 'time_entries').size).toBe(2);
    undo();
    expect(collection(d, 'time_entries').size).toBe(0);
  });

  it('leaves edits made outside it alone', () => {
    const d = new Y.Doc();
    const keep = createRecord(d, 'time_entries', { a: 0 });
    const { undo } = bulkEdit([d], (tx) => tx(d, () => void createRecord(d, 'time_entries', { a: 1 })));
    createRecord(d, 'time_entries', { a: 2 });
    undo();
    expect(collection(d, 'time_entries').size).toBe(2);
    expect(collection(d, 'time_entries').has(keep)).toBe(true);
  });
});
