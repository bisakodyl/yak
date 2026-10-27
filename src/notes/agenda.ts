import { dayNumber, dayString, occurrencesBetween, parseRule } from './recurrence';
import { isCompleted, localDate, type Task } from './tasks';

export interface AgendaItem {
  task: Task;
  /** Which date put it here. */
  kind: 'due' | 'scheduled';
  /** `YYYY-MM-DD`. */
  day: string;
  /** A later occurrence of a repeating task, not yet the one to finish. */
  future: boolean;
}

interface AgendaDay {
  day: string;
  items: AgendaItem[];
}

export interface Agenda {
  overdue: AgendaItem[];
  /** Today and the days after it that have items, in order. */
  days: AgendaDay[];
}

/**
 * Today and the next `span` days from `due` and `scheduled`. Open tasks whose date has passed are
 * overdue. A repeating task lists every occurrence in the window; only the first is the open one.
 */
export function buildAgenda(tasks: readonly Task[], now = new Date(), span = 14): Agenda {
  const today = dayNumber(localDate(now)) as number;
  const end = today + span;
  const overdue: AgendaItem[] = [];
  const byDay = new Map<string, AgendaItem[]>();
  const put = (item: AgendaItem): void => {
    const n = dayNumber(item.day) as number;
    if (n < today) {
      if (!item.future) overdue.push(item);
    } else if (n <= end) byDay.set(item.day, [...(byDay.get(item.day) ?? []), item]);
  };
  for (const task of tasks) {
    if (isCompleted(task.status)) continue;
    const due = dayNumber(task.due);
    const scheduled = dayNumber(task.scheduled);
    if (due !== null) put({ task, kind: 'due', day: dayString(due), future: false });
    if (scheduled !== null) put({ task, kind: 'scheduled', day: dayString(scheduled), future: false });
    const rule = parseRule(task.recurrence);
    if (rule && scheduled !== null) {
      const skip = new Set([...task.completeInstances, ...task.skippedInstances].map(dayNumber).filter((n): n is number => n !== null));
      for (const n of occurrencesBetween(rule, scheduled + 1, end, scheduled, skip)) put({ task, kind: 'scheduled', day: dayString(n), future: true });
    }
  }
  overdue.sort((a, b) => a.day.localeCompare(b.day) || a.task.title.localeCompare(b.task.title));
  const days = [...byDay.keys()].sort().map((day) => ({ day, items: (byDay.get(day) as AgendaItem[]).sort((a, b) => a.task.title.localeCompare(b.task.title)) }));
  return { overdue, days };
}
