import { describe, expect, it, vi } from 'vitest';
import { applyBadge, cueTitle, formatElapsed, lastStopped, RUNNING_MARK, STOPPED_MARK } from './cue';
import { addManualEntry, deleteEntry, startTimer } from './entries';
import { at, makeSpaceDocs } from './testing';

describe('cueTitle', () => {
  it('starts with the running mark and the elapsed time', () => {
    expect(cueTitle({ elapsedSeconds: 754, description: 'Write report' }, 'App')).toBe(`${RUNNING_MARK} 0:12:34 Write report – App`);
  });

  it('leaves out an empty description', () => {
    expect(cueTitle({ elapsedSeconds: 5, description: '  ' }, 'App')).toBe(`${RUNNING_MARK} 0:00:05 – App`);
  });

  it('says clearly that nothing is tracked when stopped', () => {
    expect(cueTitle(null, 'App')).toBe(`${STOPPED_MARK} Not tracking – App`);
  });

  it('uses minutes only for a hidden page', () => {
    expect(cueTitle({ elapsedSeconds: 3725, description: 'x' }, 'App', 'minutes')).toBe(`${RUNNING_MARK} 1:02 x – App`);
  });

  it('shortens long descriptions and collapses whitespace', () => {
    const title = cueTitle({ elapsedSeconds: 0, description: `a\n${'b'.repeat(80)}` }, 'App');
    const description = title.slice(`${RUNNING_MARK} 0:00:00 `.length, -' – App'.length);
    expect(description.length).toBe(40);
    expect(description.startsWith('a b')).toBe(true);
    expect(description.endsWith('…')).toBe(true);
  });

  it('never shows negative time (clock skew between devices)', () => {
    expect(cueTitle({ elapsedSeconds: -30, description: '' }, 'App')).toBe(`${RUNNING_MARK} 0:00:00 – App`);
    expect(formatElapsed(-30, 'minutes')).toBe('0:00');
  });
});

describe('applyBadge', () => {
  it('sets a plain badge while running and clears it when stopped', async () => {
    const nav = { setAppBadge: vi.fn(async () => undefined), clearAppBadge: vi.fn(async () => undefined) };
    expect(await applyBadge(nav, true)).toBe('set');
    expect(nav.setAppBadge).toHaveBeenCalledWith();
    expect(await applyBadge(nav, false)).toBe('cleared');
    expect(nav.clearAppBadge).toHaveBeenCalledOnce();
  });

  it('clears with setAppBadge(0) when clearAppBadge is missing', async () => {
    const nav = { setAppBadge: vi.fn(async () => undefined) };
    expect(await applyBadge(nav, false)).toBe('cleared');
    expect(nav.setAppBadge).toHaveBeenCalledWith(0);
  });

  it('does nothing where the API does not exist', async () => {
    expect(await applyBadge({}, true)).toBe('unsupported');
    expect(await applyBadge({}, false)).toBe('unsupported');
    expect(await applyBadge(undefined, true)).toBe('unsupported');
  });

  it('ignores refusals, thrown or rejected', async () => {
    const rejects = { setAppBadge: () => Promise.reject(new DOMException('not allowed', 'NotAllowedError')) };
    expect(await applyBadge(rejects, true)).toBe('failed');
    const throws = {
      setAppBadge: () => {
        throw new Error('policy');
      },
    };
    expect(await applyBadge(throws, true)).toBe('failed');
  });
});

describe('lastStopped', () => {
  const T0 = at(2026, 10, 14, 9);

  it('finds the entry that stopped last across spaces, skipping running and deleted ones', () => {
    const docs = makeSpaceDocs();
    const personal = docs.get('personal')!;
    const work = docs.get('work')!;
    addManualEntry(personal, 'dev', { description: 'early', start: T0, stop: T0 + 3_600_000 });
    const late = addManualEntry(work, 'dev', { description: 'late', start: T0 + 1_000, stop: T0 + 7_200_000 });
    expect(lastStopped(docs)?.entry.description).toBe('late');
    expect(lastStopped(docs)?.spaceId).toBe('work');

    startTimer(docs, 'personal', 'dev', { description: 'running' }, T0 + 9_000_000);
    expect(lastStopped(docs)?.entry.description).toBe('late');

    if (late.ok) deleteEntry(work, late.id);
    expect(lastStopped(docs)?.entry.description).toBe('early');
  });

  it('is undefined with no stopped entries', () => {
    expect(lastStopped(makeSpaceDocs())).toBeUndefined();
  });
});
