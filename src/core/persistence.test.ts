import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestPersistence } from './persistence';

const setStorage = (storage: unknown): void => {
  vi.stubGlobal('navigator', { storage });
};
afterEach(() => vi.unstubAllGlobals());

describe('requestPersistence', () => {
  it('is unsupported without the Storage API', async () => {
    setStorage(undefined);
    expect(await requestPersistence()).toBe('unsupported');
  });
  it('is granted when the browser already keeps the data or grants it now', async () => {
    setStorage({ persisted: async () => true, persist: vi.fn() });
    expect(await requestPersistence()).toBe('granted');
    setStorage({ persisted: async () => false, persist: async () => true });
    expect(await requestPersistence()).toBe('granted');
  });
  it('is denied when the browser refuses, and never throws', async () => {
    setStorage({ persisted: async () => false, persist: async () => false });
    expect(await requestPersistence()).toBe('denied');
    setStorage({ persisted: async () => { throw new Error('x'); }, persist: async () => true });
    expect(await requestPersistence()).toBe('unsupported');
  });
});
