import { describe, expect, it } from 'vitest';
import { buildAgenda } from './agenda';
import { dayNumber, nextOccurrence, occurrencesBetween, parseRule } from './recurrence';
import { newTaskText, parseQuickAdd, recurringCompletion, toTask } from './tasks';

const n = (s: string): number => dayNumber(s) as number;
const rule = (s: string) => parseRule(s) as NonNullable<ReturnType<typeof parseRule>>;
const days = (r: string, from: string, to: string) => occurrencesBetween(rule(r), n(from), n(to), n(from)).map((d) => new Date(d * 86400000).toISOString().slice(0, 10));

describe('parseRule', () => {
  it('reads TaskNotes strings and refuses what it cannot step', () => {
    expect(parseRule('DTSTART:20250804T140000Z;FREQ=WEEKLY;BYDAY=MO,WE,FR')?.byDay).toEqual([1, 3, 5]);
    expect(parseRule('FREQ=DAILY;INTERVAL=2')?.interval).toBe(2);
    expect(parseRule('FREQ=DAILY;COUNT=3')).toBeNull();
    expect(parseRule('FREQ=MONTHLY;BYDAY=-1FR')).toBeNull();
    expect(parseRule('')).toBeNull();
  });
});

describe('occurrences', () => {
  it('daily with interval', () => expect(days('DTSTART:20251001;FREQ=DAILY;INTERVAL=3', '2025-10-01', '2025-10-10')).toEqual(['2025-10-01', '2025-10-04', '2025-10-07', '2025-10-10']));
  it('weekly on days, every other week', () => {
    expect(days('DTSTART:20251006;FREQ=WEEKLY;BYDAY=MO,WE', '2025-10-06', '2025-10-15')).toEqual(['2025-10-06', '2025-10-08', '2025-10-13', '2025-10-15']);
    expect(days('DTSTART:20251006;FREQ=WEEKLY;INTERVAL=2', '2025-10-06', '2025-11-05')).toEqual(['2025-10-06', '2025-10-20', '2025-11-03']);
  });
  it('monthly on a day and on the last day', () => {
    expect(days('DTSTART:20250131;FREQ=MONTHLY;BYMONTHDAY=-1', '2025-01-31', '2025-04-30')).toEqual(['2025-01-31', '2025-02-28', '2025-03-31', '2025-04-30']);
    expect(days('DTSTART:20251015;FREQ=MONTHLY', '2025-10-01', '2025-12-31')).toEqual(['2025-10-15', '2025-11-15', '2025-12-15']);
  });
  it('yearly and until', () => {
    expect(days('DTSTART:20240229;FREQ=YEARLY', '2024-01-01', '2026-12-31')).toEqual(['2024-02-29']);
    expect(days('DTSTART:20251001;FREQ=DAILY;UNTIL=20251003', '2025-10-01', '2025-10-09')).toHaveLength(3);
  });
  it('next occurrence skips excluded days', () => {
    expect(nextOccurrence(rule('FREQ=DAILY'), n('2025-10-01'), n('2025-10-01'), new Set([n('2025-10-02')]))).toBe(n('2025-10-03'));
  });
});

const task = (props: Record<string, unknown>) => toTask({ id: 't', path: 'Tasks/T.md', properties: { tags: ['task'], ...props } as never });

describe('recurringCompletion', () => {
  it('records the occurrence and moves scheduled on, keeping the time and due', () => {
    const t = task({ scheduled: '2025-10-06T09:00', due: '2025-10-09', recurrence: 'DTSTART:20251006;FREQ=WEEKLY' });
    expect(recurringCompletion(t, new Date('2025-10-06T12:00:00'))).toEqual({ complete_instances: ['2025-10-06'], scheduled: '2025-10-13T09:00', status: 'open' });
  });
  it('skips dates already completed or skipped', () => {
    const t = task({ scheduled: '2025-10-06', recurrence: 'FREQ=DAILY', skipped_instances: ['2025-10-07'], complete_instances: ['2025-10-05'] });
    expect(recurringCompletion(t).scheduled).toBe('2025-10-08');
  });
  it('a rule we cannot read completes the task as usual', () => {
    expect(recurringCompletion(task({ recurrence: 'FREQ=DAILY;COUNT=2' })).status).toBe('done');
  });
});

describe('quick add', () => {
  it('repeat: writes TaskNotes fields', () => {
    const text = newTaskText(parseQuickAdd('Water plants due:2025-10-06 repeat:weekly'), new Date('2025-10-01T00:00:00Z'));
    expect(text).toContain('recurrence: DTSTART:20251006;FREQ=WEEKLY');
    expect(text).toContain('scheduled: 2025-10-06');
  });
});

describe('buildAgenda', () => {
  const now = new Date('2025-10-08T10:00:00');
  it('splits overdue, today and upcoming, and lists later occurrences of a repeating task', () => {
    const a = buildAgenda(
      [
        task({ title: 'Late', due: '2025-10-01' }),
        task({ title: 'Today', due: '2025-10-08', scheduled: '2025-10-08' }),
        task({ title: 'Done', due: '2025-10-08', status: 'done' }),
        task({ title: 'Plants', scheduled: '2025-10-08', recurrence: 'DTSTART:20251001;FREQ=WEEKLY' }),
        task({ title: 'Far', due: '2026-01-01' }),
      ],
      now,
    );
    expect(a.overdue.map((i) => i.task.title)).toEqual(['Late']);
    expect(a.days[0]?.day).toBe('2025-10-08');
    expect(a.days[0]?.items.map((i) => `${i.task.title}:${i.kind}`)).toEqual(['Plants:scheduled', 'Today:due', 'Today:scheduled']);
    expect(a.days.map((d) => d.day)).toEqual(['2025-10-08', '2025-10-15', '2025-10-22']);
    expect(a.days[1]?.items[0]?.future).toBe(true);
  });
});
