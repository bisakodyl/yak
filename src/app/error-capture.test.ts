import { describe, expect, it } from 'vitest';
import { reportError } from '../core/errors';
import { EventLog } from '../sync/event-log';
import { captureErrors, TOAST_EVERY_MS } from './error-capture';

function fakeTarget() {
  const handlers = new Map<string, (e: Event) => void>();
  return {
    handlers,
    addEventListener: (t: string, h: (e: Event) => void) => void handlers.set(t, h),
    removeEventListener: (t: string) => void handlers.delete(t),
  };
}

describe('captureErrors', () => {
  it('logs window errors, rejections and reported errors, and toasts at most once in a while', () => {
    const target = fakeTarget();
    const log = new EventLog(50, () => 0);
    let t = 0;
    let toasts = 0;
    const stop = captureErrors({ log, version: '1', page: () => '#/x', notify: () => toasts++, now: () => t, target });
    const boom = new Error('boom');
    target.handlers.get('error')?.({ error: boom, message: 'boom' } as unknown as Event);
    target.handlers.get('error')?.({ error: boom, message: 'boom' } as unknown as Event);
    target.handlers.get('unhandledrejection')?.({ reason: new Error('nope') } as unknown as Event);
    reportError('backup', new Error('disk'));
    expect(log.all().map((e) => [e.kind, e.count])).toEqual([['error', 2], ['error', 1], ['error:backup', 1]]);
    expect(toasts).toBe(1);
    t = TOAST_EVERY_MS;
    target.handlers.get('error')?.({ error: new Error('again') } as unknown as Event);
    expect(toasts).toBe(2);
    stop();
    expect(target.handlers.size).toBe(0);
  });
});
