import { describe, expect, it } from 'vitest';
import { formatDateValue, parseDateValue, propertyChoices } from './property-choices';

describe('propertyChoices', () => {
  it('starts with the usual values and adds what notes already use', () => {
    const c = propertyChoices([
      { properties: { status: 'Blocked', priority: 'HIGH', projects: ['[[Site]]'], contexts: ['@phone', '@home'] } },
      { properties: { status: 'open', projects: '[[Site]]', contexts: ['@phone'] } },
    ]);
    expect(c.status).toEqual(['open', 'in-progress', 'done', 'Blocked']);
    expect(c.priority).toEqual(['none', 'low', 'normal', 'high']);
    expect(c.projects).toEqual(['[[Site]]']);
    expect(c.contexts).toEqual(['@home', '@phone']);
  });
});

describe('date values', () => {
  it('reads a date, a local date and time, empty, and leaves other forms alone', () => {
    expect(parseDateValue('2026-10-20')).toEqual({ date: '2026-10-20', time: '' });
    expect(parseDateValue('2026-10-20T14:30')).toEqual({ date: '2026-10-20', time: '14:30' });
    expect(parseDateValue('2026-10-20T14:30:15')).toEqual({ date: '2026-10-20', time: '14:30' });
    expect(parseDateValue(null)).toEqual({ date: '', time: '' });
    expect(parseDateValue('2026-10-20T14:30:00Z')).toBeNull();
    expect(parseDateValue('next week')).toBeNull();
  });

  it('writes TaskNotes formats', () => {
    expect(formatDateValue('2026-10-20', '')).toBe('2026-10-20');
    expect(formatDateValue('2026-10-20', '09:05')).toBe('2026-10-20T09:05');
    expect(formatDateValue('', '09:05')).toBeNull();
  });
});
