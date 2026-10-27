import { beforeEach, describe, expect, it, vi } from 'vitest';
import { healthItems, onHealth, reportHealth, resetHealth } from './health';

describe('health', () => {
  beforeEach(() => resetHealth());

  it('collects items from every source and drops a source reporting nothing', () => {
    reportHealth('a', [{ level: 'warn', text: 'A' }]);
    reportHealth('b', [{ level: 'info', text: 'B' }]);
    expect(healthItems().map((i) => i.text)).toEqual(['A', 'B']);
    reportHealth('a', []);
    expect(healthItems().map((i) => i.text)).toEqual(['B']);
  });

  it('notifies only when the report changes', () => {
    const fn = vi.fn();
    onHealth(fn);
    reportHealth('a', [{ level: 'warn', text: 'A' }]);
    reportHealth('a', [{ level: 'warn', text: 'A' }]);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
