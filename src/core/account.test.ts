import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  accountDocId,
  accountOfDoc,
  addSpace,
  createSpace,
  derivedId,
  freeSpaceName,
  initAccountDoc,
  randomId,
  removeSpace,
  readSpaces,
  renameSpace,
  setArchived,
  spaceNameProblem,
} from './account';

const sync = (a: Y.Doc, b: Y.Doc): void => {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
};

describe('account document', () => {
  it('has 24-hex ids and document ids that round-trip', async () => {
    const id = randomId();
    expect(id).toMatch(/^[a-f0-9]{24}$/);
    expect(accountOfDoc(accountDocId(id))).toBe(id);
    expect(accountOfDoc('space/abc')).toBeUndefined();
    expect(await derivedId('a', 'b')).toBe(await derivedId('a', 'b'));
    expect(await derivedId('a', 'b')).not.toBe(await derivedId('a', 'c'));
    const doc = new Y.Doc();
    initAccountDoc(doc, id);
    expect(doc.getMap('account').get('id')).toBe(id);
  });

  it('lists spaces oldest first and refuses a name in use, ignoring case', () => {
    const doc = new Y.Doc();
    expect(addSpace(doc, 'w', 'Work', '2026-01-02T00:00:00Z')).toBeUndefined();
    expect(addSpace(doc, 'p', 'Personal', '2026-01-01T00:00:00Z')).toBeUndefined();
    expect(readSpaces(doc).map((s) => s.name)).toEqual(['Personal', 'Work']);
    expect(addSpace(doc, 'x', ' work ')).toMatch(/already a space called Work\./);
    expect(renameSpace(doc, 'p', 'WORK')).toMatch(/already/);
    expect(renameSpace(doc, 'p', 'Home')).toBeUndefined();
    expect(renameSpace(doc, 'p', 'home')).toBeUndefined(); // its own name, other case
    expect(renameSpace(doc, 'gone', 'Other')).toMatch(/no longer exists/);
    expect(spaceNameProblem(doc, '   ')).toMatch(/Enter a name/);
  });

  it('shows "(2)" when two devices renamed two spaces to the same name while apart', () => {
    const a = new Y.Doc();
    addSpace(a, 'p', 'Personal', '2026-01-01T00:00:00Z');
    addSpace(a, 'w', 'Work', '2026-01-02T00:00:00Z');
    const b = new Y.Doc();
    sync(a, b);
    renameSpace(a, 'p', 'Home');
    renameSpace(b, 'w', 'Home');
    sync(a, b);
    expect(readSpaces(a).map((s) => [s.id, s.name, s.storedName])).toEqual([
      ['p', 'Home', 'Home'],
      ['w', 'Home (2)', 'Home'],
    ]);
  });

  it('finds a free name with a hint, then a number', () => {
    const doc = new Y.Doc();
    addSpace(doc, 'p', 'Personal');
    expect(freeSpaceName(doc, 'Work')).toBe('Work');
    expect(freeSpaceName(doc, 'Personal', 'Phone')).toBe('Personal (Phone)');
    addSpace(doc, 'q', 'Personal (Phone)');
    expect(freeSpaceName(doc, 'Personal', 'Phone')).toBe('Personal 2');
  });

  it('creates a space kept by its creator, with a unique name', () => {
    const doc = new Y.Doc();
    addSpace(doc, 'p', 'Personal');
    const made = createSpace(doc, 'Side', 'dev1');
    expect('id' in made && readSpaces(doc).some((s) => s.id === made.id)).toBe(true);
    expect(createSpace(doc, 'side', 'dev1')).toHaveProperty('error');
  });

  it('archives and unarchives, and two devices agree', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addSpace(a, 'p', 'Personal');
    addSpace(a, 'w', 'Work');
    sync(a, b);
    expect(setArchived(b, 'w', true)).toBeUndefined();
    sync(a, b);
    expect(readSpaces(a).find((s) => s.id === 'w')?.archived).toBe(true);
    expect(setArchived(a, 'w', false)).toBeUndefined();
    sync(a, b);
    expect(readSpaces(b).find((s) => s.id === 'w')?.archived).toBe(false);
  });

  it('removes a space everywhere and frees its name', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    addSpace(a, 'p', 'Personal');
    addSpace(a, 'w', 'Work');
    sync(a, b);
    expect(removeSpace(a, 'w')).toBeUndefined();
    sync(a, b);
    expect(readSpaces(b).map((s) => s.id)).toEqual(['p']);
    expect(spaceNameProblem(b, 'Work')).toBeUndefined();
  });

  it('keeps at least one active space', () => {
    const doc = new Y.Doc();
    addSpace(doc, 'p', 'Personal');
    addSpace(doc, 'w', 'Work');
    expect(setArchived(doc, 'w', true)).toBeUndefined();
    expect(setArchived(doc, 'p', true)).toMatch(/at least one/);
    expect(removeSpace(doc, 'p')).toMatch(/at least one/);
    expect(removeSpace(doc, 'nope')).toMatch(/no longer exists/);
  });
});
