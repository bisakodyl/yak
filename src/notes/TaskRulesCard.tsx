import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { readTaskRules, TASK_RULES, writeTaskRule } from './task-rules';

/** The few fixed rules Tasks can apply; each can be switched off. */
export function TaskRulesCard() {
  const { account } = useApp();
  useYVersion(account.getMap('settings') as Y.AbstractType<unknown>);
  const on = readTaskRules(account);
  return (
    <div class="card st-group">
      {TASK_RULES.map((r) => (
        <label key={r.id} class="st-field">
          <input type="checkbox" checked={on[r.id]} onChange={(e) => writeTaskRule(account, r.id, (e.target as HTMLInputElement).checked)} /> {r.label}
          <span class="hint"> {r.hint}</span>
        </label>
      ))}
    </div>
  );
}

/** The Organize section for tasks: the values come from the notes' properties; the rules are switched here. */
export function TaskValues() {
  return (
    <>
      <p class="hint">Tasks offer the statuses, priorities and contexts that your notes already use, and the usual ones. These built-in rules act on them.</p>
      <TaskRulesCard />
    </>
  );
}
