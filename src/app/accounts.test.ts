import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { setAccountLabel } from '../core/account-labels';
import { otherAccounts, spaceAccounts } from './accounts';
import type { ShareView } from './shares-runtime';

const ME = '1'.repeat(32);
const ALICE = '2'.repeat(32);
const BOB = '3'.repeat(32);
const key = {} as never;

const view = (owner: string, members: [string, string?][], ownFp = ME, active = true): ShareView => ({
  space: 's',
  state: { space: 's', owner, secret: '', members: new Map(members.map(([fp, name]) => [fp, { fp, key, n: 0, ...(name ? { name } : {}) }])), ended: new Map(), devices: new Map() },
  owner: owner === ownFp,
  active,
  connected: new Map(),
  peers: [],
});

describe('otherAccounts', () => {
  const spaces = [
    { id: 'work', name: 'Work' },
    { id: 'home', name: 'Home' },
    { id: 'solo', name: 'Solo' },
  ];
  const views: Record<string, ShareView | undefined> = {
    work: view(ME, [[ME, 'Me'], [ALICE, 'Alice']]),
    home: view(ALICE, [[ALICE, 'Alice'], [ME]]),
    solo: undefined,
  };

  it('groups the shares by account and direction', () => {
    const list = otherAccounts(undefined, ME, spaces, (s) => views[s]);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ fp: ALICE, label: 'Alice', youShare: [{ name: 'Work' }], sharesWithYou: [{ name: 'Home' }] });
  });

  it('prefers your label and skips ended shares', () => {
    const doc = new Y.Doc();
    setAccountLabel(doc, ALICE, 'Alice (sister)');
    expect(otherAccounts(doc, ME, spaces, (s) => views[s])[0]?.label).toBe('Alice (sister)');
    expect(otherAccounts(doc, ME, spaces, () => view(ME, [[ME], [BOB]], ME, false))).toEqual([]);
  });

  it('names an account that gave no name', () => {
    expect(otherAccounts(undefined, ME, spaces, (s) => (s === 'work' ? view(ME, [[ME], [BOB]]) : undefined))[0]?.label).toBe('Another account');
  });

  it('lists the other accounts of one space', () => {
    expect(spaceAccounts(undefined, ME, views.home)).toEqual([{ fp: ALICE, label: 'Alice', owner: true }]);
  });
});
