import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../../app/context';
import { useLongPress, useSelection } from '../../app/selection';
import { Button, toast, usePageSelect } from '../../app/ui';
import { bulkEdit } from '../../core/bulk';
import {
  addTagTo,
  deleteNotes,
  moveToFolder,
  moveToOtherSpace,
  type NoteTarget,
  type Outcome,
  removeTagFrom,
  setDate,
  setProperties,
  shiftDate,
} from '../bulk-edit';
import { applyLinkEdits, readLinkMode } from '../link-update';
import type { NoteIndex } from '../note-store';
import { allFolders } from '../paths';
import { DEFAULT_STATUSES, statusChanges } from '../tasks';

/** What a row needs to take part in a selection of notes or tasks; null outside lists that bulk-edit. */
interface NoteSelectionApi {
  active: boolean;
  has(id: string): boolean;
  /**
   * A click on a row. Returns true when it was a selection click (selecting is on, or Ctrl, Cmd or
   * Shift was held), so the row should not open its note.
   */
  handle(id: string, ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean;
  /** A click on the row's checkbox. */
  check(id: string, ev: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void;
  /** A long press on a touch screen starts selecting with this row. */
  press(id: string): void;
}

const NoteSelection = createContext<NoteSelectionApi | null>(null);

/** Everything a note row needs: whether it is picked, its checkbox, and touch long press handlers. */
export function useNoteRow(id: string) {
  const sel = useContext(NoteSelection);
  const lp = useLongPress(() => sel?.press(id));
  return {
    sel,
    picked: !!sel?.has(id),
    handlers: lp.handlers,
    /** Use in the row's click handler: true means the click was a selection click and the row must not open the note. */
    consume: (e: MouseEvent): boolean => {
      if (lp.suppressClick()) return true;
      return sel?.handle(id, e) ?? false;
    },
    checkbox: sel?.active ? <input type="checkbox" class="row-check" aria-label="Select" checked={sel.has(id)} onClick={(e) => sel.check(id, e)} /> : null,
  };
}

type Panel = 'tags' | 'folder' | 'space' | 'status' | 'priority' | 'dates' | null;

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export interface BulkNotesProps {
  /** Documents and note indexes of the spaces on show, by space id. */
  docs: ReadonlyMap<string, Y.Doc>;
  indexes: ReadonlyMap<string, NoteIndex>;
  /** Show the task actions: status, priority, due and scheduled dates. */
  tasks?: boolean;
  children: ComponentChildren;
}

/**
 * Selection and the action bar for notes and tasks (the Notes tree and search, the Tasks list, board
 * and table). Rows read the selection from context. Each action is one transaction per space with
 * one Undo and a count; links follow a move as chosen under Settings › Links.
 */
export function BulkNotes({ docs, indexes, tasks, children }: BulkNotesProps) {
  const app = useApp();
  const spaces = app.spaces;
  const sel = useSelection();
  const root = useRef<HTMLDivElement>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [tag, setTag] = useState('');
  const [folder, setFolder] = useState('');
  const [toSpace, setToSpace] = useState('');
  const [status, setStatus] = useState('done');
  const [priority, setPriority] = useState('high');
  const [dateKey, setDateKey] = useState('due');
  const [days, setDays] = useState('1');
  const [date, setDate_] = useState('');

  const spaceOf = useMemo(() => new Map([...indexes].flatMap(([sid, ix]) => ix.notes.map((n) => [n.id, sid] as const))), [indexes]);
  const present = useMemo(() => [...spaceOf.keys()].sort().join(','), [spaceOf]);
  useEffect(() => {
    sel.keepOnly(new Set(present ? present.split(',') : []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  const shown = (): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    root.current?.querySelectorAll<HTMLElement>('[data-note-id]').forEach((el) => {
      const id = el.dataset.noteId;
      if (id && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    });
    return out;
  };
  const api: NoteSelectionApi = {
    active: sel.active,
    has: sel.has,
    handle(id, ev) {
      if (!sel.active && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey) return false;
      sel.click(id, shown(), { shift: ev.shiftKey, toggle: ev.ctrlKey || ev.metaKey });
      return true;
    },
    check: (id, ev) => sel.click(id, shown(), { shift: ev.shiftKey, toggle: ev.ctrlKey || ev.metaKey }),
    press: (id) => sel.setMany([id], true),
  };

  const targets: NoteTarget[] = [...sel.keys].flatMap((id) => {
    const sid = spaceOf.get(id);
    return sid ? [{ spaceId: sid, id }] : [];
  });
  const involved = [...new Set(targets.map((t) => t.spaceId))];
  const spaceName = (sid: string): string => spaces.find((s) => s.id === sid)?.name ?? sid;
  const folders = [...new Set(involved.flatMap((sid) => {
    const ix = indexes.get(sid);
    return ix ? allFolders(ix.notes, ix.folders) : [];
  }))].sort((a, b) => a.localeCompare(b));
  const tagNames = [...new Set([...indexes.values()].flatMap((ix) => ix.notes.flatMap((n) => n.tags)))].sort((a, b) => a.localeCompare(b));
  /** The usual values first, then any other value the notes already use. */
  const usual = (key: string, base: readonly string[]): string[] => {
    const out = [...base];
    for (const ix of indexes.values()) {
      for (const n of ix.notes) {
        const v = n.parsed.properties[key];
        if (typeof v === 'string' && v.trim() && !out.some((o) => o.toLowerCase() === v.trim().toLowerCase())) out.push(v.trim());
      }
    }
    return out;
  };
  const choices = { status: usual('status', DEFAULT_STATUSES), priority: usual('priority', ['none', 'low', 'normal', 'high']) };

  const finish = (verb: string, o: Outcome, undo: () => void, then?: () => void): void => {
    const skipped = o.skipped > 0 ? ` ${o.skipped} left as they were.` : '';
    toast(`${verb} ${plural(o.changed, 'note', 'notes')}.${skipped}`, { action: { label: 'Undo', run: undo } });
    setPanel(null);
    then?.();
  };
  /** An action that edits note text or properties: one Undo across the spaces involved. */
  const edit = (verb: string, fn: Parameters<typeof bulkEdit<Outcome>>[1], then?: () => void): void => {
    const { result, undo } = bulkEdit([...docs.values()], fn);
    finish(verb, result, undo, then);
  };
  const offerLinks = (o: { pending: { doc: Y.Doc; edits: Parameters<typeof applyLinkEdits>[1] }[]; links: number }): void => {
    if (o.pending.length === 0) return;
    toast(`${plural(o.links, 'link', 'links')} pointed at what you moved.`, {
      timeout: 20_000,
      action: { label: 'Fix links', run: () => o.pending.forEach((p) => applyLinkEdits(p.doc, p.edits)) },
    });
  };
  const moveFolder = (): void => {
    const mode = readLinkMode(app.account);
    const { result, undo } = bulkEdit([...docs.values()], (tx) => moveToFolder(docs, targets, folder, mode, tx));
    if (result.changed === 0 && result.error) toast(result.error);
    else finish('Moved', result, undo);
    offerLinks(result);
  };
  const moveSpace = (): void => {
    const mode = readLinkMode(app.account);
    const r = moveToOtherSpace(app.spaceDocs, spaceName, targets, toSpace, folder, mode);
    if (r.changed === 0 && r.error) {
      toast(r.error);
      return;
    }
    const links = mode === 'auto' && r.links > 0 ? ` Updated ${plural(r.links, 'link', 'links')}.` : '';
    toast(`Moved ${plural(r.changed, 'note', 'notes')} to ${spaceName(toSpace)}.${links}${r.skipped > 0 ? ` ${r.skipped} left as they were.` : ''}`, { action: { label: 'Undo', run: r.undo } });
    offerLinks(r);
    setPanel(null);
  };

  usePageSelect({ active: sel.active, disabled: !present && !sel.active, toggle: () => (sel.active ? sel.clear() : sel.start()) });
  const disabled = sel.size === 0;
  const toggle = (p: Exclude<Panel, null>): void => setPanel(panel === p ? null : p);
  const otherSpaces = spaces.filter((s) => app.spaceDocs.has(s.id));

  return (
    <NoteSelection.Provider value={api}>
      <div
        class={sel.active ? 'bulk-scope selecting' : 'bulk-scope'}
        ref={root}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && sel.active && !(e.target as HTMLElement).closest('input[type="text"], input:not([type]), select, textarea, .popover')) sel.clear();
        }}
      >
        {sel.active ? (
          <div class="bulk-bar" role="toolbar" aria-label="Edit selected notes">
            <div class="row">
              <strong class="bulk-count" role="status">
                {sel.size} selected
              </strong>
              <Button onClick={() => sel.setMany(shown(), true)}>Select all</Button>
            </div>
            <div class="row bulk-actions">
              <Button disabled={disabled} aria-expanded={panel === 'tags'} onClick={() => toggle('tags')}>
                Tags
              </Button>
              <Button disabled={disabled} aria-expanded={panel === 'folder'} onClick={() => toggle('folder')}>
                Move to folder
              </Button>
              {otherSpaces.length > 1 && (
                <Button disabled={disabled} aria-expanded={panel === 'space'} onClick={() => toggle('space')}>
                  Move to space
                </Button>
              )}
              {tasks && (
                <>
                  <Button disabled={disabled} aria-expanded={panel === 'status'} onClick={() => toggle('status')}>
                    Status
                  </Button>
                  <Button disabled={disabled} aria-expanded={panel === 'priority'} onClick={() => toggle('priority')}>
                    Priority
                  </Button>
                  <Button disabled={disabled} aria-expanded={panel === 'dates'} onClick={() => toggle('dates')}>
                    Dates
                  </Button>
                </>
              )}
              <Button disabled={disabled} onClick={() => edit('Deleted', (tx) => deleteNotes(docs, targets, tx), () => sel.clear())}>
                Delete
              </Button>
            </div>
            {panel === 'tags' && (
              <div class="row bulk-panel" role="group" aria-label="Tags">
                <input type="text" aria-label="Tag" list="bulk-note-tags" placeholder="Tag" value={tag} onInput={(e) => setTag((e.target as HTMLInputElement).value)} />
                <datalist id="bulk-note-tags">
                  {tagNames.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>
                <Button variant="primary" disabled={!tag.trim()} onClick={() => edit(`Added ${tag.trim()} to`, (tx) => addTagTo(docs, targets, tag, tx))}>
                  Add tag
                </Button>
                <Button disabled={!tag.trim()} onClick={() => edit(`Removed ${tag.trim()} from`, (tx) => removeTagFrom(docs, targets, tag, tx))}>
                  Remove tag
                </Button>
              </div>
            )}
            {(panel === 'folder' || panel === 'space') && (
              <div class="row bulk-panel" role="group" aria-label={panel === 'folder' ? 'Move to folder' : 'Move to space'}>
                {panel === 'space' && (
                  <select aria-label="Space to move the selected notes to" value={toSpace} onChange={(e) => setToSpace((e.target as HTMLSelectElement).value)}>
                    <option value="">Choose a space</option>
                    {otherSpaces.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
                <input type="text" aria-label="Folder (empty for the top level)" list="bulk-note-folders" placeholder="Folder, for example Projects/2026" value={folder} onInput={(e) => setFolder((e.target as HTMLInputElement).value)} />
                <datalist id="bulk-note-folders">
                  {folders.map((f) => (
                    <option key={f} value={f} />
                  ))}
                </datalist>
                <Button variant="primary" disabled={panel === 'space' && !toSpace} onClick={panel === 'folder' ? moveFolder : moveSpace}>
                  Move
                </Button>
                <span class="muted">Links follow as set under Settings › Links.</span>
              </div>
            )}
            {panel === 'status' && (
              <div class="row bulk-panel" role="group" aria-label="Status">
                <select aria-label="Status for the selected tasks" value={status} onChange={(e) => setStatus((e.target as HTMLSelectElement).value)}>
                  {choices.status.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button variant="primary" onClick={() => edit(`Set ${status} on`, (tx) => setProperties(docs, targets, statusChanges(status), tx))}>
                  Apply
                </Button>
              </div>
            )}
            {panel === 'priority' && (
              <div class="row bulk-panel" role="group" aria-label="Priority">
                <select aria-label="Priority for the selected tasks" value={priority} onChange={(e) => setPriority((e.target as HTMLSelectElement).value)}>
                  {choices.priority.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <Button variant="primary" onClick={() => edit(`Set ${priority} priority on`, (tx) => setProperties(docs, targets, { priority }, tx))}>
                  Apply
                </Button>
              </div>
            )}
            {panel === 'dates' && (
              <div class="row bulk-panel" role="group" aria-label="Dates">
                <select aria-label="Date to change" value={dateKey} onChange={(e) => setDateKey((e.target as HTMLSelectElement).value)}>
                  <option value="due">Due</option>
                  <option value="scheduled">Scheduled</option>
                </select>
                <label>
                  Days <input type="number" min="1" step="1" aria-label="Days to shift" value={days} onInput={(e) => setDays((e.target as HTMLInputElement).value)} />
                </label>
                <Button onClick={() => edit(`Moved ${dateKey} earlier on`, (tx) => shiftDate(docs, targets, dateKey, -Math.max(1, Math.trunc(Number(days)) || 1), tx))}>Earlier</Button>
                <Button onClick={() => edit(`Moved ${dateKey} later on`, (tx) => shiftDate(docs, targets, dateKey, Math.max(1, Math.trunc(Number(days)) || 1), tx))}>Later</Button>
                <label>
                  Or set <input type="date" aria-label="Date to set" value={date} onInput={(e) => setDate_((e.target as HTMLInputElement).value)} />
                </label>
                <Button variant="primary" disabled={!date} onClick={() => edit(`Set ${dateKey} on`, (tx) => setDate(docs, targets, dateKey, date, tx))}>
                  Set date
                </Button>
                <Button onClick={() => edit(`Cleared ${dateKey} on`, (tx) => setDate(docs, targets, dateKey, null, tx))}>Clear</Button>
              </div>
            )}
          </div>
        ) : null}
        {children}
      </div>
    </NoteSelection.Provider>
  );
}
