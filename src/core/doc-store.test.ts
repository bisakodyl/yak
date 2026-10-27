import { describe, expect, it } from 'vitest';
import { DocumentStore, docDbName, isValidDocId, spaceDocId } from './doc-store';

const memory = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });

describe('DocumentStore', () => {
  it('opens a document once and returns the same instance', async () => {
    const store = new DocumentStore(memory);
    const a = await store.open('space/personal');
    const b = await store.open('space/personal');
    expect(a).toBe(b);
    expect([...store.opened().keys()]).toEqual(['space/personal']);
  });

  it('tells listeners about each newly opened document', async () => {
    const store = new DocumentStore(memory);
    const seen: string[] = [];
    store.onOpened((id) => seen.push(id));
    await store.open('space/personal');
    await store.open('space/work');
    await store.open('space/work');
    expect(seen).toEqual(['space/personal', 'space/work']);
  });

  it('rejects ids that could escape the naming scheme', async () => {
    expect(isValidDocId('space/work/notes/1234')).toBe(true);
    expect(isValidDocId('../x')).toBe(false);
    expect(isValidDocId('Space/Work')).toBe(false);
    expect(isValidDocId('space/')).toBe(false);
    await expect(new DocumentStore(memory).open('../evil')).rejects.toThrow();
  });

  it('persists each document in the database docDbName names', async () => {
    const names: string[] = [];
    await new DocumentStore((name) => (names.push(name), memory())).open('space/work');
    expect(names).toEqual([docDbName('space/work')]);
    expect(docDbName('space/work')).toBe('app-doc-space/work');
  });

  it('names space documents', () => {
    expect(spaceDocId('work')).toBe('space/work');
  });
});
