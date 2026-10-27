import { describe, expect, it } from 'vitest';
import { askBackupFirst } from './client';

/** A waiting worker that answers GET_VERSION on the port it is given, as sw.ts does. */
const worker = (answer: unknown) => ({
  postMessage(message: unknown, transfer?: unknown) {
    if ((message as { type?: string }).type === 'GET_VERSION') (transfer as MessagePort[])[0]?.postMessage(answer);
  },
});

describe('askBackupFirst', () => {
  it('reads the flag from the waiting version', async () => {
    expect(await askBackupFirst(worker({ version: 'x', backupFirst: true }))).toBe(true);
    expect(await askBackupFirst(worker({ version: 'x', backupFirst: false }))).toBe(false);
    expect(await askBackupFirst(worker({ version: 'x' }))).toBe(false);
  });
  it('treats an older version that does not answer, or a worker that throws, as no', async () => {
    expect(await askBackupFirst({ postMessage: () => undefined }, 20)).toBe(false);
    expect(await askBackupFirst({ postMessage: () => { throw new Error('gone'); } }, 20)).toBe(false);
  });
});
