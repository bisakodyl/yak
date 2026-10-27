import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { isLeft } from '../core/devices';
import { keeps, keepAll } from '../core/keeps';
import type { SyncService } from '../sync/sync-service';
import { applyPendingErase, leaveAccount } from './leave';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

function fakeSync(): { sync: SyncService; unpaired: () => number } {
  let n = 0;
  const sync = { status: { peers: [] }, unpair: () => void n++ } as unknown as SyncService;
  return { sync, unpaired: () => n };
}

describe('leaving the account', () => {
  it('marks the device as left, forgets the code, and keeps its data by default', async () => {
    const account = new Y.Doc();
    keepAll(account, 'me', ['w1', 'p1']);
    const { sync, unpaired } = fakeSync();
    let reloaded = 0;
    await leaveAccount({ sync, account, me: 'me', erase: [], storage: memory(), reload: () => void reloaded++ });
    expect(isLeft(account, 'me')).toBe(true);
    expect(unpaired()).toBe(1);
    expect(reloaded).toBe(0);
    expect(keeps(account, 'me', 'w1') && keeps(account, 'me', 'p1')).toBe(true);
  });

  it('stops keeping the spaces it erases, and erases them at the next start', async () => {
    const account = new Y.Doc();
    keepAll(account, 'me', ['w1', 'p1']);
    const { sync } = fakeSync();
    const storage = memory();
    let reloaded = 0;
    await leaveAccount({ sync, account, me: 'me', erase: ['w1'], storage, reload: () => void reloaded++ });
    expect(reloaded).toBe(1);
    expect(keeps(account, 'me', 'w1')).toBe(false);
    expect(keeps(account, 'me', 'p1')).toBe(true);
    const removed: string[] = [];
    expect(await applyPendingErase(storage, async (name) => void removed.push(name))).toEqual(['w1']);
    expect(removed).toEqual(['app-doc-space/w1', 'app-doc-space/w1/private', 'app-doc-space/w1/log']);
    // Only once.
    expect(await applyPendingErase(storage, async () => undefined)).toEqual([]);
  });

  it('erases nothing when the stored list is missing or damaged', async () => {
    const storage = memory();
    expect(await applyPendingErase(storage, async () => undefined)).toEqual([]);
    storage.setItem('app-erase-spaces', '{nonsense');
    expect(await applyPendingErase(storage, async () => undefined)).toEqual([]);
  });
});
