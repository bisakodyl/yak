import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addSpace } from '../core/account';
import { DocumentStore } from '../core/doc-store';
import { keepAll, setKeeps } from '../core/keeps';
import { AccountState } from './account-state';

const memory = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });

describe('AccountState', () => {
  it('shows and opens only the spaces this device keeps', async () => {
    const store = new DocumentStore(memory);
    const doc = new Y.Doc();
    addSpace(doc, 'p1', 'Personal', '1');
    addSpace(doc, 'w1', 'Work', '2');
    keepAll(doc, 'laptop', ['w1']);
    const state = new AccountState('acc', doc, store, 'laptop');
    await state.refresh();
    expect(state.current.spaces.map((s) => s.name)).toEqual(['Work']);
    expect(state.current.allSpaces.map((s) => s.name)).toEqual(['Personal', 'Work']);
    expect([...state.current.spaceDocs.keys()]).toEqual(['w1']);
    expect([...store.opened().keys()].some((id) => id.includes('p1'))).toBe(false);
    expect([...state.spaceIds()]).toEqual(['w1']);
  });

  it('follows a space being kept or dropped without a reload', async () => {
    const store = new DocumentStore(memory);
    const doc = new Y.Doc();
    addSpace(doc, 'p1', 'Personal', '1');
    const state = new AccountState('acc', doc, store, 'phone');
    await state.refresh();
    expect(state.current.spaces).toEqual([]);
    const seen: string[][] = [];
    state.subscribe((s) => seen.push(s.spaces.map((x) => x.name)));
    setKeeps(doc, 'phone', 'p1', true);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.current.spaces.map((s) => s.name)).toEqual(['Personal']);
    setKeeps(doc, 'phone', 'p1', false);
    await new Promise((r) => setTimeout(r, 20));
    expect(state.current.spaces).toEqual([]);
    expect(seen).toContainEqual(['Personal']);
  });
});
