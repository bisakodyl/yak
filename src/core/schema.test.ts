import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collection, createRecord, initSpaceDoc, liveRecords, softDelete, updateRecord } from './schema';

describe('schema helpers', () => {
  it('creates records under fresh ids and lists live ones', () => {
    const doc = new Y.Doc();
    const a = createRecord(doc, 'clients', { name: 'Acme', archived: false, deleted: false, created_at: 'x', updated_at: 'x' });
    const b = createRecord(doc, 'clients', { name: 'Beta', archived: false, deleted: false, created_at: 'x', updated_at: 'x' });
    expect(a).not.toBe(b);
    softDelete(doc, 'clients', b);
    expect(liveRecords<{ name: string }>(doc, 'clients').map((c) => c.name)).toEqual(['Acme']);
    expect(collection(doc, 'clients').size).toBe(2);
  });

  it('updates only existing records and stamps updated_at', () => {
    const doc = new Y.Doc();
    expect(updateRecord(doc, 'projects', 'missing', { name: 'x' })).toBe(false);
    const id = createRecord(doc, 'projects', { name: 'P', updated_at: 'old', deleted: false });
    updateRecord(doc, 'projects', id, { name: 'Q' });
    const rec = collection(doc, 'projects').get(id);
    expect(rec?.get('name')).toBe('Q');
    expect(rec?.get('updated_at')).not.toBe('old');
  });

  it('stamps the schema version once', () => {
    const doc = new Y.Doc();
    initSpaceDoc(doc);
    const first = doc.getMap('meta').get('created_at');
    initSpaceDoc(doc);
    expect(doc.getMap('meta').get('schema_version')).toBe(1);
    expect(doc.getMap('meta').get('created_at')).toBe(first);
  });
});
