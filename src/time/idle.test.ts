import { describe, expect, it } from 'vitest';
import { IDLE_THRESHOLD_MS, IdleTracker } from './idle';

const MIN = 60_000;

describe('IdleTracker', () => {
  it('reports nothing for a short absence', () => {
    const t = new IdleTracker(0);
    t.hide(1000);
    expect(t.show(1000 + 9 * MIN)).toBeNull();
  });

  it('reports the gap after more than ten minutes hidden', () => {
    const t = new IdleTracker(0);
    t.hide(5000);
    const gap = t.show(5000 + 10 * MIN + 1);
    expect(gap).toEqual({ since: 5000, ms: 10 * MIN + 1 });
    expect(t.show(5000 + 10 * MIN + 2000)).toBeNull();
  });

  it('exactly the threshold is not idle', () => {
    const t = new IdleTracker(0);
    t.hide(0);
    expect(t.show(IDLE_THRESHOLD_MS)).toBeNull();
  });

  it('catches a sleep where the page stopped ticking without a hide event', () => {
    const t = new IdleTracker(0);
    for (let s = 1; s <= 60; s++) expect(t.tick(s * 1000)).toBeNull();
    const gap = t.tick(60_000 + 3 * 3600_000);
    expect(gap?.since).toBe(60_000);
  });
});
