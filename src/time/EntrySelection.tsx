import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { useSelection, useLongPress } from '../app/selection';
import { Button, toast, usePageSelect } from '../app/ui';
import { bulkEdit } from '../core/bulk';
import { deleteAll, moveToSpace, type Outcome, setBillable, setDate, setProject, setTag, shiftDays, type Spaces, type Target } from './bulk-edit';
import { type EntryRecord, isRunning } from './entries';
import type { TimeData } from './hooks';

/** What a row needs to take part in a selection; null outside lists that bulk-edit. */
export interface EntrySelectionApi {
  /** Checkboxes show. */
  active: boolean;
  has(id: string): boolean;
  /** Whether none, some or all of these entries are selected. */
  state(ids: readonly string[]): 'none' | 'some' | 'all';
  /** A click on a row or its checkbox. `ids` is one entry, or all entries of a group of repeats. */
  click(ids: readonly string[], ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  set(ids: readonly string[], on: boolean): void;
  /** A long press on a touch screen: start selecting with these rows. */
  press(ids: readonly string[]): void;
}

export const EntrySelection = createContext<EntrySelectionApi | null>(null);

export function useEntrySelection(): EntrySelectionApi | null {
  return useContext(EntrySelection);
}

/** Handlers for a row that starts a selection on a long press, and a check to swallow the click after it. */
export function useRowPress(ids: readonly string[]): ReturnType<typeof useLongPress> {
  const sel = useEntrySelection();
  return useLongPress(() => sel?.press(ids));
}

/** The entry ids of the rows in the list, in the order shown (a group counts as its entries). */
function shownOrder(root: HTMLElement | null): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  root?.querySelectorAll<HTMLElement>('[data-entry], [data-ids]').forEach((el) => {
    const ids = el.dataset.ids ? el.dataset.ids.split(',') : el.dataset.entry ? [el.dataset.entry] : [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  });
  return out;
}

type Panel = 'project' | 'tags' | 'dates' | 'space' | null;

const plural = (n: number): string => (n === 1 ? '1 entry' : `${n} entries`);

export interface BulkEntriesProps {
  /** Entries shown in the list, each with its `spaceId`. */
  entries: readonly EntryRecord[];
  /** Each space's data, by space id: the catalogs and documents the actions edit. */
  slices: ReadonlyMap<string, TimeData>;
  children: ComponentChildren;
}

/**
 * Selection and the action bar for a list of time entries (Entries, Timer). Rows read the selection
 * from context. Each action is one transaction with one Undo; running entries are never changed.
 */
export function BulkEntries({ entries, slices, children }: BulkEntriesProps) {
  const { spaces } = useApp();
  const sel = useSelection();
  const root = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [project, setProjectName] = useState('');
  const [tag, setTagName] = useState('');
  const [days, setDays] = useState('1');
  const [date, setDateValue] = useState('');
  const [toSpace, setToSpace] = useState('');
  const selectable = entries.filter((e) => !isRunning(e));
  const byId = new Map(entries.map((e) => [e.id, e]));

  // A selected entry that leaves the list (deleted, moved, or scrolled out of the week) leaves the selection.
  const present = selectable.map((e) => e.id).join(',');
  useEffect(() => {
    sel.keepOnly(new Set(present ? present.split(',') : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  const state = (ids: readonly string[]): 'none' | 'some' | 'all' => {
    const n = ids.filter((id) => sel.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  };
  const api: EntrySelectionApi = {
    active: sel.active,
    has: sel.has,
    state,
    click(ids, ev) {
      const mods = { shift: ev.shiftKey, toggle: ev.ctrlKey || ev.metaKey };
      if (ids.length === 1 || mods.shift) {
        sel.click(ids[0]!, shownOrder(root.current), mods);
        if (ids.length > 1) sel.setMany(ids, true);
      } else sel.setMany(ids, state(ids) !== 'all');
    },
    set: sel.setMany,
    press: (ids) => {
      sel.setMany(ids, true);
    },
  };

  const targets: Target[] = [...sel.keys].flatMap((id) => {
    const e = byId.get(id);
    return e?.spaceId ? [{ spaceId: e.spaceId, id }] : [];
  });
  const handles: Spaces = new Map([...slices].map(([id, s]) => [id, { doc: s.doc, privateDoc: s.privateDoc }]));
  const deviceId = [...slices.values()][0]?.deviceId ?? '';
  const spaceIds = [...new Set(targets.map((t) => t.spaceId))];

  const apply = (verb: string, fn: (tx: Parameters<Parameters<typeof bulkEdit>[1]>[0]) => Outcome, after?: () => void): void => {
    const docs = [...handles.values()].flatMap((h) => [h.doc, h.privateDoc]);
    const { result, undo } = bulkEdit(docs, fn);
    const note = result.skipped > 0 ? ` ${result.skipped} left as they were.` : '';
    toast(`${verb} ${plural(result.changed)}.${note}`, { action: { label: 'Undo', run: undo } });
    setPanel(null);
    after?.();
  };

  const projectNames = [...new Set(spaceIds.flatMap((id) => (slices.get(id)?.projects ?? []).filter((p) => p.active).map((p) => p.name)))].sort((a, b) => a.localeCompare(b));
  const tagNames = [...new Set([...slices.values()].flatMap((s) => s.tagNames))].sort((a, b) => a.localeCompare(b));
  const otherSpaces = spaces.filter((s) => slices.has(s.id));
  usePageSelect({ active: sel.active, disabled: selectable.length === 0 && !sel.active, toggle: () => (sel.active ? sel.clear() : sel.start()) });
  const toggle = (p: Exclude<Panel, null>): void => setPanel(panel === p ? null : p);

  return (
    <EntrySelection.Provider value={api}>
      <div
        class={sel.active ? 'bulk-scope selecting' : 'bulk-scope'}
        ref={root}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && sel.active && !(e.target as HTMLElement).closest('input[type="text"], input:not([type]), select, textarea, .popover')) sel.clear();
        }}
      >
        {sel.active ? (
          <div class="bulk-bar" role="toolbar" aria-label="Edit selected entries">
            <div class="row">
              <strong class="bulk-count" role="status">
                {sel.size} selected
              </strong>
              <Button onClick={() => sel.setMany(selectable.map((e) => e.id), true)}>Select all</Button>
            </div>
            <div class="row bulk-actions">
              <Button disabled={sel.size === 0} aria-expanded={panel === 'project'} onClick={() => toggle('project')}>
                Set project
              </Button>
              <Button disabled={sel.size === 0} aria-expanded={panel === 'tags'} onClick={() => toggle('tags')}>
                Tags
              </Button>
              <Button disabled={sel.size === 0} onClick={() => apply('Made billable:', (tx) => setBillable(handles, targets, true, tx))}>
                Billable
              </Button>
              <Button disabled={sel.size === 0} onClick={() => apply('Made not billable:', (tx) => setBillable(handles, targets, false, tx))}>
                Not billable
              </Button>
              <Button disabled={sel.size === 0} aria-expanded={panel === 'dates'} onClick={() => toggle('dates')}>
                Move dates
              </Button>
              {otherSpaces.length > 1 && (
                <Button disabled={sel.size === 0} aria-expanded={panel === 'space'} onClick={() => toggle('space')}>
                  Move to space
                </Button>
              )}
              <Button disabled={sel.size === 0} onClick={() => apply('Deleted', (tx) => deleteAll(handles, targets, tx), () => sel.clear())}>
                Delete
              </Button>
            </div>
            {panel === 'project' && (
              <div class="row bulk-panel" role="group" aria-label="Set project">
                <select aria-label="Project for the selected entries" value={project} onChange={(e) => setProjectName((e.target as HTMLSelectElement).value)}>
                  <option value="">No project</option>
                  {projectNames.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <Button variant="primary" onClick={() => apply(project ? `Set ${project} on` : 'Removed the project from', (tx) => setProject(handles, targets, project || null, tx))}>
                  Apply
                </Button>
                <span class="muted">Matched by name in each entry's own space.</span>
              </div>
            )}
            {panel === 'tags' && (
              <div class="row bulk-panel" role="group" aria-label="Tags">
                <input type="text" aria-label="Tag" list="bulk-tags" placeholder="Tag" value={tag} onInput={(e) => setTagName((e.target as HTMLInputElement).value)} />
                <datalist id="bulk-tags">
                  {tagNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <Button variant="primary" disabled={!tag.trim()} onClick={() => apply(`Added ${tag.trim()} to`, (tx) => setTag(handles, targets, tag, true, tx))}>
                  Add tag
                </Button>
                <Button disabled={!tag.trim()} onClick={() => apply(`Removed ${tag.trim()} from`, (tx) => setTag(handles, targets, tag, false, tx))}>
                  Remove tag
                </Button>
              </div>
            )}
            {panel === 'dates' && (
              <div class="row bulk-panel" role="group" aria-label="Move dates">
                <label>
                  Days <input type="number" min="1" step="1" aria-label="Days to shift" value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
                </label>
                <Button onClick={() => apply('Moved earlier:', (tx) => shiftDays(handles, targets, -Math.max(1, Math.trunc(Number(days)) || 1), tx))}>Earlier</Button>
                <Button onClick={() => apply('Moved later:', (tx) => shiftDays(handles, targets, Math.max(1, Math.trunc(Number(days)) || 1), tx))}>Later</Button>
                <label>
                  Or put them on <input type="date" aria-label="Date for the selected entries" value={date} onInput={(e) => setDateValue((e.target as HTMLInputElement).value)} />
                </label>
                <Button variant="primary" disabled={!date} onClick={() => apply(`Moved to ${date}:`, (tx) => setDate(handles, targets, date, tx))}>
                  Set date
                </Button>
              </div>
            )}
            {panel === 'space' && (
              <div class="row bulk-panel" role="group" aria-label="Move to space">
                <select aria-label="Space to move the selected entries to" value={toSpace} onChange={(e) => setToSpace((e.target as HTMLSelectElement).value)}>
                  <option value="">Choose a space</option>
                  {otherSpaces.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <Button variant="primary" disabled={!toSpace} onClick={() => apply(`Moved to ${otherSpaces.find((s) => s.id === toSpace)?.name ?? ''}:`, (tx) => moveToSpace(handles, targets, toSpace, deviceId, tx), () => sel.clear())}>
                  Move
                </Button>
                <span class="muted">An entry's project follows by name; it is made in the other space when missing.</span>
              </div>
            )}
          </div>
        ) : null}
        {children}
      </div>
    </EntrySelection.Provider>
  );
}
