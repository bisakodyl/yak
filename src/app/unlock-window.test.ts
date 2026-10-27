import { describe, expect, it } from 'vitest';
import { UNLOCK_MS, UnlockWindow } from './unlock-window';

const key = {} as CryptoKey;

describe('unlock window (F-324)', () => {
  it('locks 5 minutes after unlocking when the key is not used', () => {
    let t = 0;
    const w = new UnlockWindow(() => t);
    w.set('fp', key);
    t = UNLOCK_MS - 1;
    expect(w.peek('fp')).toBe(key);
    t = UNLOCK_MS;
    expect(w.peek('fp')).toBeUndefined();
    expect(w.left('fp')).toBe(0);
  });

  it('each use restarts the 5 minutes, so it lasts 5 minutes after the last use', () => {
    let t = 0;
    const w = new UnlockWindow(() => t);
    w.set('fp', key);
    for (let i = 0; i < 4; i++) {
      t += UNLOCK_MS - 1000;
      expect(w.use('fp')).toBe(key);
    }
    expect(w.left('fp')).toBe(UNLOCK_MS);
    t += UNLOCK_MS - 1;
    expect(w.peek('fp')).toBe(key);
    t += 1;
    expect(w.use('fp')).toBeUndefined();
  });

  it('looking does not extend it, and a use after it ran out does not revive it', () => {
    let t = 0;
    const w = new UnlockWindow(() => t);
    w.set('fp', key);
    t = UNLOCK_MS - 10;
    w.peek('fp');
    t = UNLOCK_MS + 10;
    expect(w.peek('fp')).toBeUndefined();
    expect(w.use('fp')).toBeUndefined();
    expect(w.peek('fp')).toBeUndefined();
  });

  it('is for one account key only', () => {
    const w = new UnlockWindow(() => 0);
    w.set('a', key);
    expect(w.use('b')).toBeUndefined();
    expect(w.left('b')).toBe(0);
  });
});
