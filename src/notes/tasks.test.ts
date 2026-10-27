import { describe, expect, it } from 'vitest';
import { parseNote } from './frontmatter';
import {
  allContexts,
  endOfWeek,
  filterRows,
  filterTasks,
  groupByStatus,
  isTaskProps,
  newTaskText,
  parseQuickAdd,
  archiveChanges,
  completionChanges,
  dueForArchive,
  checklistProgress,
  toTask,
  groupByProject,
  projectName,
  sortRows,
  sortTasks,
  statusChanges,
  statusColumns,
  tableColumns,
  tasksFrom,
  type TaskFilter,
} from './tasks';

const src = (id: string, path: string, properties: Record<string, unknown>) => ({ id, path, properties });
const NOW = new Date(2026, 9, 15, 12); // Thursday 15 October 2026, local time

const sources = [
  src('1', 'Tasks/Report.md', { tags: ['task'], status: 'open', due: '2026-10-14', priority: 'high', contexts: ['office'] }),
  src('2', 'Tasks/Call.md', { title: 'Call Bob', tags: 'task, work', status: 'in-progress', due: '2026-10-15T09:00', contexts: 'phone, office' }),
  src('3', 'Tasks/Done.md', { tags: ['Task'], status: 'done', due: '2026-10-01' }),
  src('4', 'Tasks/Later.md', { tags: ['task'], status: 'waiting', due: '2026-10-18', timeEstimate: 30 }),
  src('5', 'Tasks/Someday.md', { tags: ['task'] }),
  src('6', 'Notes/NotATask.md', { tags: ['work'], status: 'open' }),
];
const tasks = tasksFrom(sources);
const f = (x: Partial<TaskFilter>): TaskFilter => ({ status: 'all', due: 'any', context: '', ...x });
const ids = (ts: { id: string }[]): string[] => ts.map((t) => t.id);

describe('task identification and fields', () => {
  it('treats notes tagged task (any case, list or string) as tasks', () => {
    expect(isTaskProps({ tags: ['task'] })).toBe(true);
    expect(isTaskProps({ tags: '#task' })).toBe(true);
    expect(isTaskProps({ tags: ['tasks'] })).toBe(false);
    expect(isTaskProps({})).toBe(false);
    expect(ids(tasks)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('reads TaskNotes fields with defaults', () => {
    const [report, call, , later, someday] = tasks;
    expect(report!.title).toBe('Report');
    expect(call!.title).toBe('Call Bob');
    expect(call!.contexts).toEqual(['phone', 'office']);
    expect(later!.timeEstimate).toBe(30);
    expect(someday!.status).toBe('open');
    expect(someday!.priority).toBe('normal');
  });
});

describe('task queries', () => {
  it('filters by status', () => {
    expect(ids(filterTasks(tasks, f({ status: 'active' }), NOW))).toEqual(['1', '2', '4', '5']);
    expect(ids(filterTasks(tasks, f({ status: 'waiting' }), NOW))).toEqual(['4']);
  });

  it('filters by due date', () => {
    expect(endOfWeek(NOW)).toBe('2026-10-18');
    expect(ids(filterTasks(tasks, f({ due: 'overdue' }), NOW))).toEqual(['1']);
    expect(ids(filterTasks(tasks, f({ due: 'today' }), NOW))).toEqual(['2']);
    expect(ids(filterTasks(tasks, f({ due: 'week' }), NOW))).toEqual(['2', '4']);
    expect(ids(filterTasks(tasks, f({ due: 'none' }), NOW))).toEqual(['5']);
  });

  it('filters by context', () => {
    expect(ids(filterTasks(tasks, f({ context: 'Office' }), NOW))).toEqual(['1', '2']);
    expect(allContexts(tasks)).toEqual(['office', 'phone']);
  });

  it('sorts open before done, then due date, priority, title', () => {
    expect(ids(sortTasks(tasks))).toEqual(['1', '2', '4', '5', '3']);
  });

  it('groups by status with default columns first and keeps unknown statuses', () => {
    expect(statusColumns(tasks)).toEqual(['open', 'in-progress', 'done', 'waiting']);
    const g = groupByStatus(tasks);
    expect(ids(g.get('open')!)).toEqual(['1', '5']);
    expect(ids(g.get('waiting')!)).toEqual(['4']);
  });

  it('sets and clears the completion date', () => {
    expect(completionChanges(true, NOW)).toEqual({ status: 'done', completedDate: '2026-10-15' });
    expect(completionChanges(false, NOW)).toEqual({ status: 'open', completedDate: undefined });
    expect(statusChanges('waiting', NOW)).toEqual({ status: 'waiting', completedDate: undefined });
  });
});

describe('quick add', () => {
  it('parses contexts, tags, due date and priority', () => {
    expect(parseQuickAdd('Call Bob @phone #client due:2026-10-20 !high about #3')).toEqual({
      projects: [],
      repeat: null,
      title: 'Call Bob about #3',
      contexts: ['phone'],
      tags: ['client'],
      due: '2026-10-20',
      priority: 'high',
    });
  });

  it('writes a TaskNotes-compatible note', () => {
    const text = newTaskText(parseQuickAdd('Write report @office due:2026-10-20'), new Date('2026-10-15T10:00:00Z'));
    const p = parseNote(text);
    expect(p.properties).toEqual({
      title: 'Write report',
      status: 'open',
      priority: 'normal',
      due: '2026-10-20',
      contexts: ['office'],
      tags: ['task'],
      dateCreated: '2026-10-15T10:00:00.000Z',
    });
    expect(isTaskProps(p.properties)).toBe(true);
  });
});

describe('table view', () => {
  const rows = tasks.map((t) => ({ id: t.id, path: t.path, title: t.title, properties: t.properties }));

  it('derives columns from properties', () => {
    expect(tableColumns(rows)).toEqual(['status', 'priority', 'due', 'contexts', 'timeEstimate', 'tags']);
  });

  it('sorts with empty cells last in both directions', () => {
    expect(ids(sortRows(rows, 'due', 'asc'))).toEqual(['3', '1', '2', '4', '5']);
    expect(ids(sortRows(rows, 'due', 'desc'))).toEqual(['4', '2', '1', '3', '5']);
    expect(ids(sortRows(rows, 'title', 'asc'))).toEqual(['2', '3', '4', '1', '5']);
  });

  it('filters by key:value terms and free words', () => {
    expect(ids(filterRows(rows, 'status:open'))).toEqual(['1']);
    expect(ids(filterRows(rows, 'contexts:office'))).toEqual(['1', '2']);
    expect(ids(filterRows(rows, 'due:'))).toEqual(['5']);
    expect(ids(filterRows(rows, 'timeestimate:*'))).toEqual(['4']);
    expect(ids(filterRows(rows, 'bob'))).toEqual(['2']);
    expect(ids(filterRows(rows, 'office high'))).toEqual(['1']);
    expect(ids(filterRows(rows, ''))).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('checklists and projects', () => {
  it('counts checkbox lines outside code', () => {
    const body = '- [ ] a\n- [x] b\n  * [X] c\n```\n- [ ] no\n```\n- plain\n- [ ]no space';
    expect(checklistProgress(body)).toEqual({ done: 2, total: 3 });
    expect(checklistProgress('nothing')).toBeNull();
  });

  it('names projects from wikilinks', () => {
    expect(projectName('[[Acme]]')).toBe('Acme');
    expect(projectName('[[Clients/Acme|The job]]')).toBe('Acme');
    expect(projectName(' Plain ')).toBe('Plain');
  });

  it('groups by project with done counts, no-project last', () => {
    const mk = (id: string, status: string, projects: string[]) =>
      toTask({ id, path: `Tasks/${id}.md`, properties: { status, projects, tags: ['task'] } });
    const g = groupByProject([mk('a', 'done', ['[[Zed]]']), mk('b', 'open', ['[[Zed]]', 'Acme']), mk('c', 'open', [])]);
    expect(g.map((x) => [x.name, x.progress])).toEqual([
      ['Acme', { done: 0, total: 1 }],
      ['Zed', { done: 1, total: 2 }],
      ['No project', { done: 0, total: 1 }],
    ]);
  });
});

describe('archive and rules', () => {
  const mk = (props: Record<string, unknown>) => toTask({ id: 't', path: 'Tasks/T.md', properties: { tags: ['task'], ...props } as never });
  it('archives by tag and restores', () => {
    const t = mk({});
    expect(archiveChanges(t, true)).toEqual({ tags: ['task', 'archived'] });
    expect(archiveChanges(mk({ tags: ['task', 'archived', 'x'] }), false)).toEqual({ tags: ['task', 'x'] });
    expect(mk({ tags: ['task', 'Archived'] }).archived).toBe(true);
  });
  it('finds tasks finished long enough ago', () => {
    const now = new Date('2026-10-30T10:00:00');
    const old = mk({ status: 'done', completedDate: '2026-09-30' });
    const recent = mk({ status: 'done', completedDate: '2026-10-20' });
    const open = mk({ status: 'open', completedDate: '2026-01-01' });
    expect(dueForArchive([old, recent, open], 30, now)).toEqual([old]);
  });
  it('can leave out the completed date', () => {
    expect(completionChanges(true, new Date(), false)).toEqual({ status: 'done' });
    expect(statusChanges('done', new Date(), false)).toEqual({ status: 'done' });
  });
});
