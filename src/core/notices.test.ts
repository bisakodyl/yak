import { beforeEach, describe, expect, it } from 'vitest';
import { addNotice, dismissAllNotices, dismissNotice, notices, resetNotices } from './notices';

describe('notices', () => {
  beforeEach(() => resetNotices());

  it('adds once per key, even after dismissal', () => {
    expect(addNotice({ key: 'a', kind: 'bulk-change', text: 'x' })).toBe(true);
    expect(addNotice({ key: 'a', kind: 'bulk-change', text: 'x' })).toBe(false);
    dismissNotice('a');
    expect(notices()).toHaveLength(0);
    expect(addNotice({ key: 'a', kind: 'bulk-change', text: 'x' })).toBe(false);
  });

  it('lists newest first and dismisses all', () => {
    addNotice({ key: 'a', kind: 'timer-stopped', text: 'a' });
    addNotice({ key: 'b', kind: 'timer-stopped', text: 'b' });
    expect(notices().map((n) => n.key)).toEqual(['b', 'a']);
    dismissAllNotices();
    expect(notices()).toEqual([]);
  });
});
