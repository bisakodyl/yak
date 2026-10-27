import { describe, expect, it } from 'vitest';
import { ERROR_KEYS_MAX, EventLog } from './event-log';

describe('EventLog', () => {
  it('records entries in order with timestamps from the clock', () => {
    let t = 1000;
    const log = new EventLog(10, () => t++);
    log.log('peer', 'connection connected');
    log.log('page', 'visibility hidden');
    expect(log.all().map((e) => [e.at, e.kind, e.detail])).toEqual([
      [1000, 'peer', 'connection connected'],
      [1001, 'page', 'visibility hidden'],
    ]);
  });

  it('drops the oldest entries beyond capacity', () => {
    const log = new EventLog(3, () => 0);
    for (let i = 0; i < 5; i++) log.log('n', String(i));
    expect(log.all().map((e) => e.detail)).toEqual(['2', '3', '4']);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const log = new EventLog(10, () => 0);
    const seen: string[] = [];
    const stop = log.subscribe((e) => seen.push(e.kind));
    log.log('a');
    stop();
    log.log('b');
    expect(seen).toEqual(['a']);
  });

  it('exports plain text without addresses', () => {
    const log = new EventLog(10, () => Date.UTC(2026, 9, 16, 12, 0, 0));
    log.log('ice', 'disconnected');
    expect(log.toText()).toBe('2026-10-16T12:00:00.000Z ice disconnected');
  });

  it('logs a repeated error once with a count, and tells subscribers about the change', () => {
    const log = new EventLog(10, () => 0);
    const seen: number[] = [];
    log.subscribe((e) => seen.push(e.count ?? 0));
    for (let i = 0; i < 3; i++) log.logError('error', new Error('boom'), { version: '1.0', page: '#/timer' });
    expect(log.all()).toHaveLength(1);
    expect(log.all()[0]?.count).toBe(3);
    expect(log.all()[0]?.detail).toContain('Error: boom (v1.0 #/timer)');
    expect(seen).toEqual([0, 2, 3]);
    expect(log.toText()).toContain('(x3)');
    log.logError('error', new Error('other'));
    expect(log.all()).toHaveLength(2);
  });

  it('stays within its size cap under many different errors', () => {
    const log = new EventLog(20, () => 0);
    for (let i = 0; i < ERROR_KEYS_MAX * 3; i++) log.logError('error', new Error(`e${i}`));
    expect(log.all().length).toBe(20);
    // The oldest error was forgotten, so it is recorded afresh rather than counted.
    log.logError('error', new Error('e0'));
    expect(log.all().at(-1)?.count).toBe(1);
  });
});
