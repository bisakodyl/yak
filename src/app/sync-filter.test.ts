import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { keepAll } from '../core/keeps';
import { allowsDoc, allowsShareDoc, allowsShareFile, type ShareFilterInput, type SyncFilterInput } from './sync-filter';

const ACCOUNT = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const WORK = 'c'.repeat(24);
const PERSONAL = 'd'.repeat(24);

function setup(): { account: Y.Doc; input: (docId: string, over?: Partial<SyncFilterInput>) => SyncFilterInput } {
  const account = new Y.Doc();
  keepAll(account, 'laptop', [WORK, PERSONAL]);
  keepAll(account, 'worklaptop', [WORK]);
  const input = (docId: string, over: Partial<SyncFilterInput> = {}): SyncFilterInput => ({
    docId,
    peerId: 'worklaptop',
    account,
    accountId: ACCOUNT,
    me: 'laptop',
    paired: true,
    pairedAccountId: ACCOUNT,
    ...over,
  });
  return { account, input };
}

describe('which documents sync with which device', () => {
  it('syncs the account document with every device of the account, and no other account', () => {
    const { input } = setup();
    expect(allowsDoc(input(`account/${ACCOUNT}`, { peerId: 'brand-new-device' }))).toBe(true);
    expect(allowsDoc(input(`account/${OTHER}`))).toBe(false);
  });

  it('lets a device that has just joined accept the account document it joined', () => {
    const { input } = setup();
    expect(allowsDoc(input(`account/${OTHER}`, { pairedAccountId: undefined }))).toBe(true);
    expect(allowsDoc(input(`account/${OTHER}`, { pairedAccountId: undefined, paired: false }))).toBe(false);
  });

  it('syncs a space, and its private part, only between two devices that both keep it', () => {
    const { input } = setup();
    expect(allowsDoc(input(`space/${WORK}`))).toBe(true);
    expect(allowsDoc(input(`space/${WORK}/private`))).toBe(true);
    // The work laptop does not keep Personal: nothing of it is sent to it, or accepted from it.
    expect(allowsDoc(input(`space/${PERSONAL}`))).toBe(false);
    expect(allowsDoc(input(`space/${PERSONAL}/private`))).toBe(false);
  });

  it('gives a device that has chosen nothing no space at all', () => {
    const { input } = setup();
    expect(allowsDoc(input(`space/${WORK}`, { peerId: 'new-phone' }))).toBe(false);
    expect(allowsDoc(input(`space/${WORK}`, { me: 'new-phone', peerId: 'laptop' }))).toBe(false);
  });

  it('syncs no space before the pairing is known to belong to this account', () => {
    const { input } = setup();
    expect(allowsDoc(input(`space/${WORK}`, { pairedAccountId: undefined }))).toBe(false);
    expect(allowsDoc(input(`space/${WORK}`, { pairedAccountId: OTHER }))).toBe(false);
  });

  it('refuses anything that is not a space or an account document', () => {
    const { input } = setup();
    expect(allowsDoc(input('backup/secrets'))).toBe(false);
    expect(allowsDoc(input('space'))).toBe(false);
  });

  it('syncs the account log with its own account only, and a space log only between devices that keep the space', () => {
    const { input } = setup();
    expect(allowsDoc(input(`account/${ACCOUNT}/log`, { peerId: 'brand-new-device' }))).toBe(true);
    expect(allowsDoc(input(`account/${OTHER}/log`))).toBe(false);
    expect(allowsDoc(input(`account/${ACCOUNT}/log`, { pairedAccountId: undefined }))).toBe(false);
    expect(allowsDoc(input(`space/${WORK}/log`))).toBe(true);
    // The work laptop does not keep Personal: its log never reaches it.
    expect(allowsDoc(input(`space/${PERSONAL}/log`))).toBe(false);
  });

  it('a moved account syncs only under its new id; the old document no longer goes out (#295)', () => {
    const { input } = setup();
    const FP = 'e'.repeat(24);
    const moved = { accountId: FP, pairedAccountId: FP };
    expect(allowsDoc(input(`account/${FP}`, moved))).toBe(true);
    expect(allowsDoc(input(`account/${FP}/log`, moved))).toBe(true);
    expect(allowsDoc(input(`account/${ACCOUNT}`, moved))).toBe(false);
    expect(allowsDoc(input(`space/${WORK}`, moved))).toBe(true);
    // A pairing still under the old id gets no space until the start moves it.
    expect(allowsDoc(input(`space/${WORK}`, { ...moved, pairedAccountId: ACCOUNT }))).toBe(false);
  });
});

describe('device keys (#256)', () => {
  const keys = (required: boolean, peerVerified: boolean, held: string[] = []) => ({ required, peerVerified, peerHolds: (s: string) => held.includes(s) });

  it('compatible mode: the rules above, whatever the keys say', () => {
    const { input } = setup();
    expect(allowsDoc(input(`space/${WORK}`, { keys: keys(false, false) }))).toBe(true);
    expect(allowsDoc(input(`account/${ACCOUNT}`, { keys: keys(false, false) }))).toBe(true);
  });

  it('keys required: a peer without a proven device key gets no document at all', () => {
    const { input } = setup();
    for (const id of [`account/${ACCOUNT}`, `space/${WORK}`, `log/${ACCOUNT}`]) expect(allowsDoc(input(id, { keys: keys(true, false, [WORK]) }))).toBe(false);
  });

  it('keys required: a space goes only to a proven peer that holds its key, and keeps still decides', () => {
    const { input } = setup();
    expect(allowsDoc(input(`account/${ACCOUNT}`, { keys: keys(true, true) }))).toBe(true);
    expect(allowsDoc(input(`space/${WORK}`, { keys: keys(true, true) }))).toBe(false);
    expect(allowsDoc(input(`space/${WORK}`, { keys: keys(true, true, [WORK]) }))).toBe(true);
    expect(allowsDoc(input(`space/${PERSONAL}`, { keys: keys(true, true, [PERSONAL]) }))).toBe(false);
  });
});

describe('a share mesh (#259)', () => {
  const share = (docId: string, over: Partial<ShareFilterInput> = {}): ShareFilterInput => ({ docId, space: WORK, peerVerified: true, ...over });

  it('allows exactly the space document, to a verified peer', () => {
    expect(allowsShareDoc(share(`space/${WORK}`))).toBe(true);
    expect(allowsShareDoc(share(`space/${WORK}`, { peerVerified: false }))).toBe(false);
  });

  it('refuses the private part, the log, an account document and another space', () => {
    expect(allowsShareDoc(share(`space/${WORK}/private`))).toBe(false);
    expect(allowsShareDoc(share(`space/${WORK}/log`))).toBe(false);
    expect(allowsShareDoc(share(`account/${ACCOUNT}`))).toBe(false);
    expect(allowsShareDoc(share(`account/${ACCOUNT}/log`))).toBe(false);
    expect(allowsShareDoc(share(`space/${PERSONAL}`))).toBe(false);
    expect(allowsShareDoc(share(`space/${WORK}x`))).toBe(false);
  });
});

describe('files on a share mesh (#272)', () => {
  it('sends only the shared space\'s files, to a verified peer', () => {
    expect(allowsShareFile({ unit: WORK, space: WORK, peerVerified: true })).toBe(true);
    expect(allowsShareFile({ unit: WORK, space: WORK, peerVerified: false })).toBe(false);
    expect(allowsShareFile({ unit: PERSONAL, space: WORK, peerVerified: true })).toBe(false);
    expect(allowsShareFile({ unit: `${WORK}x`, space: WORK, peerVerified: true })).toBe(false);
  });
});
