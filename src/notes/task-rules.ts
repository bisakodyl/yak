import type * as Y from 'yjs';

/**
 * Built-in task rules: fixed behaviours that can be switched on or off (no user scripts).
 * Stored per account in the `settings` map as `task_rule_<id>` → true or false.
 */
export interface TaskRule {
  id: 'completed_date' | 'start_on_timer' | 'archive_old_done';
  label: string;
  hint: string;
  default: boolean;
}

export const ARCHIVE_AFTER_DAYS = 30;

export const TASK_RULES: readonly TaskRule[] = [
  { id: 'completed_date', label: 'Set the completed date when a task is moved to Done', hint: 'Writes completedDate; moving it back removes it.', default: true },
  { id: 'start_on_timer', label: 'Move an open task to In progress when its timer starts', hint: 'Only tasks whose status is open.', default: false },
  { id: 'archive_old_done', label: `Archive tasks ${ARCHIVE_AFTER_DAYS} days after they were completed`, hint: 'Runs when the Tasks page opens; archived tasks can be restored.', default: false },
];

export type TaskRuleState = Record<TaskRule['id'], boolean>;

export function readTaskRules(account: Y.Doc | undefined): TaskRuleState {
  const map = account?.getMap<unknown>('settings');
  const out = {} as TaskRuleState;
  for (const r of TASK_RULES) {
    const v = map?.get(`task_rule_${r.id}`);
    out[r.id] = typeof v === 'boolean' ? v : r.default;
  }
  return out;
}

export function writeTaskRule(account: Y.Doc, id: TaskRule['id'], on: boolean): void {
  account.getMap<unknown>('settings').set(`task_rule_${id}`, on);
}
