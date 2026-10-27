import { describe, expect, it } from 'vitest';
import { parseDuration } from './duration';
import { groupRepeats, repeatKey } from './grouping';
import type { EntryRecord } from './entries';

describe('parseDuration', () => {
  it.each([
    ['1:30', 5400],
    ['0:05', 300],
    ['1:30:15', 5415],
    ['90', 5400],
    ['90m', 5400],
    ['90 min', 5400],
    ['1.5h', 5400],
    ['1,5 h', 5400],
    ['.25', 900],
    ['1.25', 4500],
    ['1h 30m', 5400],
    ['1h30', 5400],
    ['2h15', 8100],
    ['2 hours', 7200],
    ['45s', 45],
    ['1m 30s', 90],
    ['  2H ', 7200],
  ])('%s is %i seconds', (text, seconds) => {
    expect(parseDuration(text)).toBe(seconds);
  });

  it.each(['', 'abc', '1:75', '1h 2h', 'h', '-5', '1:2:3:4', '5 5'])('rejects %j', (text) => {
    expect(parseDuration(text)).toBeNull();
  });
});

const entry = (id: string, start: string, over: Partial<EntryRecord> = {}): EntryRecord => ({
  id,
  start,
  stop: start,
  duration: 0,
  description: 'Standup',
  project_id: 'p1',
  task_id: null,
  tags: ['meeting'],
  billable: true,
  device_id: 'd',
  created_at: start,
  updated_at: start,
  deleted: false,
  ...over,
});

describe('groupRepeats', () => {
  it('collapses same description, project, tags and billable; keeps the newest position', () => {
    const list = [
      entry('a', '2026-10-14T12:00:00Z'),
      entry('b', '2026-10-14T11:00:00Z', { description: 'Review' }),
      entry('c', '2026-10-14T09:00:00Z', { description: ' standup ' }),
      entry('d', '2026-10-14T08:00:00Z', { tags: ['other'] }),
      entry('e', '2026-10-14T07:00:00Z', { billable: false }),
    ];
    const groups = groupRepeats(list);
    expect(groups.map((g) => g.entries.map((e) => e.id))).toEqual([['a', 'c'], ['b'], ['d'], ['e']]);
  });

  it('ignores tag order and case', () => {
    expect(repeatKey(entry('a', 'x', { tags: ['B', 'a'] }))).toBe(repeatKey(entry('b', 'x', { tags: ['A', 'b'] })));
    expect(repeatKey(entry('a', 'x', { project_id: null }))).not.toBe(repeatKey(entry('b', 'x')));
  });

  it('sorts a group newest first whatever the input order', () => {
    const groups = groupRepeats([entry('old', '2026-10-14T07:00:00Z'), entry('new', '2026-10-14T09:00:00Z')]);
    expect(groups[0]!.entries.map((e) => e.id)).toEqual(['new', 'old']);
  });
});
