import { describe, expect, it } from 'vitest';
import { CURRENT_ACCOUNT_KEY } from '../core/account';
import { docDbName } from '../core/doc-store';
import { MemoryStore } from '../core/history/memory-store';
import type { SyncService } from '../sync/sync-service';
import { applyPendingReset, resetDevice, resetDocIds } from './reset';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

function fakeSync(): { sync: SyncService; unpaired: () => number } {
  let n = 0;
  return { sync: { unpair: () => void n++ } as unknown as SyncService, unpaired: () => n };
}

describe('resetting this device', () => {
  it('erases a space at the next start and stays in the account', async () => {
    const storage = memory();
    const { sync, unpaired } = fakeSync();
    let reloaded = 0;
    resetDevice({ sync, storage, spaces: ['w1'], clearHistory: false, reload: () => void reloaded++ });
    expect(reloaded).toBe(1);
    expect(unpaired()).toBe(0);
    const removed: string[] = [];
    const ids = await applyPendingReset(storage, { remove: async (n) => void removed.push(n) });
    expect(ids).toEqual(['space/w1', 'space/w1/private', 'space/w1/log']);
    expect(removed).toEqual(ids.map(docDbName));
    expect(await applyPendingReset(storage, { remove: async () => void removed.push('again') })).toEqual([]);
  });

  it('everything also erases the account document and forgets the sync code', async () => {
    const storage = memory();
    storage.setItem(CURRENT_ACCOUNT_KEY, 'acc1');
    const { sync, unpaired } = fakeSync();
    resetDevice({ sync, storage, spaces: ['p1'], accountId: 'acc1', clearHistory: false, reload: () => undefined });
    expect(unpaired()).toBe(1);
    expect(storage.getItem(CURRENT_ACCOUNT_KEY)).toBe('');
    expect(await applyPendingReset(storage, { remove: async () => undefined })).toEqual(resetDocIds(['p1'], 'acc1'));
  });

  it('clears the history log only when asked', async () => {
    const keep = memory();
    const clear = memory();
    const { sync } = fakeSync();
    resetDevice({ sync, storage: keep, spaces: ['w1'], clearHistory: false, reload: () => undefined });
    resetDevice({ sync, storage: clear, spaces: ['w1'], clearHistory: true, reload: () => undefined });
    const cleared: string[] = [];
    const io = { remove: async () => undefined, clearHistory: async (id: string) => void cleared.push(id) };
    await applyPendingReset(keep, io);
    expect(cleared).toEqual([]);
    await applyPendingReset(clear, io);
    expect(cleared).toEqual(['space/w1', 'space/w1/private', 'space/w1/log']);
  });

  it('ignores a damaged record', async () => {
    const storage = memory();
    storage.setItem('app-reset-device', '{oops');
    expect(await applyPendingReset(storage, { remove: async () => undefined })).toEqual([]);
  });

  it('removes a document from the history store with its versions', async () => {
    const store = new MemoryStore();
    const seg = { docId: 'space/w1', start: 0, end: 1, update: new Uint8Array(), local: true, baseline: true };
    await store.append(seg);
    await store.append({ ...seg, docId: 'space/p1' });
    await store.addMark({ id: 'm', docId: 'space/w1', noteId: 'n', name: 'v', at: 1, text: '' });
    await store.removeDoc('space/w1');
    expect(await store.docIds()).toEqual(['space/p1']);
    expect(await store.marks('space/w1')).toEqual([]);
  });
});
