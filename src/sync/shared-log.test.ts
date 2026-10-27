import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { appendLine, LOG_MAX_LINES_PER_DEVICE, LOG_RETENTION_MS, linesToText, readLines, removeOwnLines, SharedLogWriter, trimOwnLines } from './shared-log';
import { EventLog } from './event-log';

const line = (at: number, kind = 'k') => ({ at, kind, detail: 'd' });

describe('shared log', () => {
  it('merges the lines of several documents by time', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    appendLine(a, 'dev1', line(30));
    appendLine(a, 'dev1', line(10));
    appendLine(b, 'dev2', line(20));
    expect(readLines([a, b]).map((l) => [l.at, l.device])).toEqual([[10, 'dev1'], [20, 'dev2'], [30, 'dev1']]);
  });

  it('trims only this device\'s lines older than the retention', () => {
    const doc = new Y.Doc();
    const now = 10 * LOG_RETENTION_MS;
    appendLine(doc, 'me', line(now - LOG_RETENTION_MS - 1));
    appendLine(doc, 'me', line(now - 5));
    appendLine(doc, 'other', line(now - LOG_RETENTION_MS - 1));
    expect(trimOwnLines(doc, 'me', now)).toBe(1);
    expect(readLines([doc]).map((l) => l.device)).toEqual(['other', 'me']);
  });

  it('keeps at most the cap per device, dropping the oldest', () => {
    const doc = new Y.Doc();
    for (let i = 0; i < 12; i++) appendLine(doc, 'me', line(100 + i));
    appendLine(doc, 'other', line(1));
    trimOwnLines(doc, 'me', 200, LOG_RETENTION_MS, 5);
    const mine = readLines([doc]).filter((l) => l.device === 'me');
    expect(mine.length).toBe(5);
    expect(mine[0]?.at).toBe(107);
    expect(readLines([doc]).some((l) => l.device === 'other')).toBe(true);
    expect(LOG_MAX_LINES_PER_DEVICE).toBeGreaterThan(0);
  });

  it('routes events to the account log, or to the log of the space they are about', async () => {
    const log = new EventLog(10, () => 5);
    const account = new Y.Doc();
    const space = new Y.Doc();
    log.log('pairing', 'before start');
    const writer = new SharedLogWriter({
      log,
      device: 'me',
      now: () => 10,
      openAccountLog: async () => account,
      openSpaceLog: (id) => (id === 'kept' ? Promise.resolve(space) : undefined),
    });
    writer.start();
    log.log('space', 'x: syncing space', 'kept');
    log.log('space', 'y: syncing space', 'not-kept');
    await new Promise((r) => setTimeout(r, 0));
    writer.close();
    expect(readLines([account]).map((l) => l.kind)).toEqual(['pairing']);
    expect(readLines([space]).map((l) => l.detail)).toEqual(['x: syncing space']);
  });

  it('formats lines for a report', () => {
    expect(linesToText([{ at: 0, device: 'd1', kind: 'sync', detail: 'attached' }], () => 'Phone')).toBe('1970-01-01T00:00:00.000Z [Phone] sync attached');
  });

  it('writes nothing while disabled, and removes only this device\'s lines on request', async () => {
    const log = new EventLog(10, () => 5);
    const account = new Y.Doc();
    let on = false;
    const writer = new SharedLogWriter({ log, device: 'me', now: () => 10, enabled: () => on, openAccountLog: async () => account, openSpaceLog: () => undefined });
    writer.start();
    log.log('sync', 'off');
    await new Promise((r) => setTimeout(r, 0));
    expect(readLines([account])).toHaveLength(0);
    on = true;
    log.log('sync', 'on');
    appendLine(account, 'other', { at: 1, kind: 'x', detail: '' });
    await new Promise((r) => setTimeout(r, 0));
    await writer.clearOwn();
    writer.close();
    expect(readLines([account]).map((l) => l.device)).toEqual(['other']);
    expect(removeOwnLines(account, 'other')).toBe(1);
  });

  it('keeps one line for a repeated error and updates its count', async () => {
    const log = new EventLog(10, () => 5);
    const account = new Y.Doc();
    const writer = new SharedLogWriter({ log, device: 'me', now: () => 10, openAccountLog: async () => account, openSpaceLog: () => undefined });
    writer.start();
    for (let i = 0; i < 4; i++) log.logError('error', new Error('boom'));
    await new Promise((r) => setTimeout(r, 0));
    writer.close();
    const lines = readLines([account]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.count).toBe(4);
  });
});
