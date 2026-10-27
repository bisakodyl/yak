import { useEffect, useMemo, useState } from 'preact/hooks';
import { bulkEdit } from '../../core/bulk';
import { hiddenTags, setTagHidden } from '../../core/hidden-tags';
import { moveTag, tagExists } from '../../core/move-tag';
import { Button, IconEdit, IconMore, IconTag, IconTrash, MenuButton, toast } from '../ui';
import { useApp } from '../context';
import type { SelectionApi } from '../selection';
import { allTagSources, type TagItem } from '../tag-sources';
import { useSearchTarget } from '../search-sources';

interface SpaceUse {
  counts: { source: string; singular: string; plural: string; count: number }[];
  hidden: boolean;
}

/** One tag name across the spaces shown: the same name in two spaces is one row. */
interface TagRow {
  key: string;
  name: string;
  spaces: Map<string, SpaceUse>;
}

const countText = (c: { singular: string; plural: string; count: number }): string => `${c.count} ${c.count === 1 ? c.singular : c.plural}`;
const summary = (counts: SpaceUse['counts']): string => counts.filter((c) => c.count > 0).map(countText).join(' · ') || 'not used';

type Mode = { kind: 'rename'; text: string } | { kind: 'remove' } | { kind: 'hide' } | { kind: 'items' } | { kind: 'move'; from: string; to: string; as: string | null };

function useRows(spaceIds: string[], version: number): TagRow[] {
  const app = useApp();
  const ids = spaceIds.join(',');
  return useMemo(() => {
    const rows = new Map<string, TagRow>();
    const touch = (key: string, name: string, spaceId: string): SpaceUse => {
      const row = rows.get(key) ?? { key, name, spaces: new Map() };
      rows.set(key, row);
      const use = row.spaces.get(spaceId) ?? { counts: [], hidden: false };
      row.spaces.set(spaceId, use);
      return use;
    };
    for (const spaceId of spaceIds) {
      const doc = app.spaceDocs.get(spaceId);
      const hidden = doc ? hiddenTags(doc) : new Set<string>();
      for (const source of allTagSources()) {
        for (const [key, t] of source.tags(app, spaceId)) {
          const use = touch(key, t.name, spaceId);
          use.counts.push({ source: source.id, singular: source.singular, plural: source.plural, count: t.count });
          use.hidden = hidden.has(key);
        }
      }
      // A hidden tag that nothing uses any more is still listed, so it can be shown again.
      for (const key of hidden) touch(key, key, spaceId).hidden = true;
    }
    return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app.spaceDocs, ids, version]);
}

/** Space checkboxes for the spaces that have the tag; every one starts checked ("all"). */
function SpaceChoice({ row, chosen, onChange, nameOf }: { row: TagRow; chosen: Set<string>; onChange(next: Set<string>): void; nameOf(id: string): string }) {
  return (
    <fieldset class="row space-choice">
      <legend class="muted">Spaces</legend>
      {[...row.spaces.keys()].map((id) => (
        <label key={id} class="check">
          <input
            type="checkbox"
            checked={chosen.has(id)}
            aria-label={`${nameOf(id)} for ${row.name}`}
            onChange={(e) => {
              const next = new Set(chosen);
              if ((e.target as HTMLInputElement).checked) next.add(id);
              else next.delete(id);
              onChange(next);
            }}
          />
          <span>{nameOf(id)}</span>
        </label>
      ))}
    </fieldset>
  );
}

/** Selection key of a tag in one space: `t:<space>:<name>` (the bar on Organize reads it). */
const tagKey = (spaceId: string, name: string): string => `t:${spaceId}:${name}`;

function Tags({ spaceIds, version, selection }: { spaceIds: string[]; version: number; selection?: SelectionApi }) {
  const app = useApp();
  const rows = useRows(spaceIds, version);
  const multi = spaceIds.length > 1;
  const [open, setOpen] = useState<{ key: string; mode: Mode; chosen: Set<string> } | null>(null);
  const sources = allTagSources();
  useSearchTarget(['tag'], (t) => setOpen({ key: t.id, mode: { kind: 'items' }, chosen: new Set(spaceIds) }));
  const nameOf = (id: string): string => app.spaces.find((s) => s.id === id)?.name ?? '';

  const run = (message: string, chosen: Set<string>, change: (spaceId: string) => number): void => {
    const docs = [...chosen].flatMap((id) => sources.flatMap((s) => s.docs(app, id)));
    const { result, undo } = bulkEdit(docs, () => [...chosen].reduce((n, id) => n + change(id), 0));
    toast(message.replace('{n}', String(result)), { action: { label: 'Undo', run: undo } });
  };
  const rename = (row: TagRow, to: string, chosen: Set<string>): void => {
    const target = to.trim();
    if (!target || chosen.size === 0) return;
    run(`Renamed “${row.name}” to “${target}” on {n} items.`, chosen, (id) => sources.reduce((n, s) => n + s.rename(app, id, row.name, target), 0));
    setOpen(null);
  };
  const remove = (row: TagRow, chosen: Set<string>): void => {
    if (chosen.size === 0) return;
    run(`Removed “${row.name}” from {n} items.`, chosen, (id) => sources.reduce((n, s) => n + s.remove(app, id, row.name), 0));
    setOpen(null);
  };
  const setHidden = (row: TagRow, hide: boolean, chosen: Set<string>): void => {
    for (const id of chosen) {
      const doc = app.spaceDocs.get(id);
      if (doc) setTagHidden(doc, row.name, hide);
    }
    setOpen(null);
  };
  const moveToSpace = (row: TagRow, m: Extract<Mode, { kind: 'move' }>): void => {
    const src = app.spaceDocs.get(m.from);
    const dest = app.spaceDocs.get(m.to);
    if (!src || !dest) return;
    const docs = [src, dest];
    const { undo } = bulkEdit(docs, (tx) => moveTag(src, dest, row.name, m.as ?? undefined, tx));
    toast(`Moved tag “${row.name}” to ${nameOf(m.to)}. It is hidden from pickers in ${nameOf(m.from)}; items keep their tags.`, { action: { label: 'Undo', run: undo } });
    setOpen(null);
  };
  const itemsOf = (row: TagRow): { source: string; items: TagItem[] }[] =>
    sources
      .map((s) => ({ source: s.plural, items: [...row.spaces.keys()].flatMap((id) => s.items(app, id, row.name).map((i) => (multi ? { ...i, label: `${i.label} (${nameOf(id)})` } : i))) }))
      .filter((x) => x.items.length > 0);
  const exists = (to: string): boolean => rows.some((r) => r.key === to.trim().toLowerCase() && r.key !== open?.key);
  const total = (row: TagRow, chosen?: Set<string>): number =>
    [...row.spaces].filter(([id]) => !chosen || chosen.has(id)).reduce((n, [, u]) => n + u.counts.reduce((m, c) => m + c.count, 0), 0);
  const sumOf = (row: TagRow, chosen: Set<string>): string => {
    const merged = new Map<string, SpaceUse['counts'][number]>();
    for (const [id, use] of row.spaces)
      if (chosen.has(id)) for (const c of use.counts) merged.set(c.source, { ...c, count: (merged.get(c.source)?.count ?? 0) + c.count });
    return summary([...merged.values()]);
  };
  const begin = (row: TagRow, mode: Mode): void => setOpen({ key: row.key, mode, chosen: new Set(row.spaces.keys()) });

  if (rows.length === 0) return <p class="empty">No tags yet.</p>;
  return (
    <ul class="proj-list tag-list">
      {rows.map((row) => {
        const mode = open?.key === row.key ? open.mode : null;
        const chosen = open?.key === row.key ? open.chosen : new Set(row.spaces.keys());
        const hiddenAll = [...row.spaces.values()].every((u) => u.hidden);
        const hiddenSome = [...row.spaces.values()].some((u) => u.hidden);
        const choice = multi && row.spaces.size > 1 ? <SpaceChoice row={row} chosen={chosen} nameOf={nameOf} onChange={(next) => open && setOpen({ ...open, chosen: next })} /> : null;
        return (
          <li key={row.key} ref={(el) => { if (el && open?.key === row.key && open.mode.kind === 'items') el.scrollIntoView?.({ block: 'nearest' }); }} class={hiddenAll ? 'tag-row row-host hidden-tag' : 'tag-row row-host'} data-tag={row.key}>
            <div class="row">
              {selection?.active && (
                <input
                  type="checkbox"
                  class="row-check"
                  aria-label={`Select tag ${row.name}`}
                  checked={[...row.spaces.keys()].every((id) => selection.has(tagKey(id, row.name)))}
                  onChange={(e) => selection.setMany([...row.spaces.keys()].map((id) => tagKey(id, row.name)), (e.target as HTMLInputElement).checked)}
                />
              )}
              <button type="button" class="link-btn tag-name" aria-expanded={mode?.kind === 'items'} onClick={() => setOpen(mode?.kind === 'items' ? null : { key: row.key, mode: { kind: 'items' }, chosen })}>
                {row.name}
              </button>
              {multi ? (
                <span class="muted tag-spaces">
                  {[...row.spaces].map(([id, u]) => `${nameOf(id)}: ${summary(u.counts)}`).join(' · ')}
                </span>
              ) : (
                <span class="muted">{summary([...row.spaces.values()].flatMap((u) => u.counts))}</span>
              )}
              {hiddenSome && <span class="muted">· {hiddenAll ? 'hidden from pickers' : 'hidden in some spaces'}</span>}
              <span class="row-actions">
                <MenuButton
                  label={`More actions for tag ${row.name}`}
                  icon={<IconMore />}
                  items={[
                    { label: 'Rename or merge', icon: <IconEdit />, onSelect: () => begin(row, { kind: 'rename', text: row.name }) },
                    {
                      label: hiddenAll ? 'Show again' : 'Hide from pickers',
                      icon: <IconTag />,
                      onSelect: () => (multi && row.spaces.size > 1 ? begin(row, { kind: 'hide' }) : setHidden(row, !hiddenAll, new Set(row.spaces.keys()))),
                    },
                    ...(app.spaces.length > 1
                      ? [{ label: 'Move to space…', icon: <IconMore />, onSelect: () => {
                          const from = [...row.spaces.keys()][0] ?? '';
                          setOpen({ key: row.key, mode: { kind: 'move', from, to: app.spaces.find((x) => x.id !== from)?.id ?? '', as: null }, chosen });
                        } }]
                      : []),
                    { label: 'Remove from all items', icon: <IconTrash />, danger: true, onSelect: () => begin(row, { kind: 'remove' }) },
                  ]}
                />
              </span>
            </div>
            {mode?.kind === 'rename' && (
              <div class="tag-panel">
                {choice}
                <div class="row">
                  <input
                    type="text"
                    aria-label={`New name for ${row.name}`}
                    value={mode.text}
                    onInput={(e) => open && setOpen({ ...open, mode: { kind: 'rename', text: (e.target as HTMLInputElement).value } })}
                    onKeyDown={(e) => e.key === 'Enter' && rename(row, mode.text, chosen)}
                  />
                  <span class="muted" role="status">
                    {mode.text.trim().toLowerCase() === row.key ? 'Changes the spelling' : exists(mode.text) ? 'Merges into the tag that exists' : 'Renames'} on {sumOf(row, chosen)}.
                  </span>
                  <Button variant="primary" disabled={!mode.text.trim() || chosen.size === 0} onClick={() => rename(row, mode.text, chosen)}>
                    {exists(mode.text) ? 'Merge' : 'Rename'}
                  </Button>
                  <Button onClick={() => setOpen(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {mode?.kind === 'hide' && (
              <div class="tag-panel">
                {choice}
                <div class="row">
                  <Button variant="primary" disabled={chosen.size === 0} onClick={() => setHidden(row, !hiddenAll, chosen)}>
                    {hiddenAll ? 'Show again' : 'Hide from pickers'}
                  </Button>
                  <Button onClick={() => setOpen(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {mode?.kind === 'remove' && (
              <div class="tag-panel">
                {choice}
                <div class="row">
                  <span role="status">
                    Bulk edit: takes “{row.name}” off {total(row, chosen)} {total(row, chosen) === 1 ? 'item' : 'items'} ({sumOf(row, chosen)}). You can undo it right after.
                  </span>
                  <Button variant="primary" disabled={chosen.size === 0} onClick={() => remove(row, chosen)}>
                    Remove from all items
                  </Button>
                  <Button onClick={() => setOpen(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {mode?.kind === 'move' && (
              <div class="tag-panel" role="group" aria-label={`Move tag ${row.name} to another space`}>
                <div class="row">
                  {row.spaces.size > 1 && (
                    <select aria-label={`Move ${row.name} from`} value={mode.from} onChange={(e) => { const from = (e.target as HTMLSelectElement).value; open && setOpen({ ...open, mode: { ...mode, from, to: mode.to === from ? (app.spaces.find((x) => x.id !== from)?.id ?? '') : mode.to } }); }}>
                      {[...row.spaces.keys()].map((id) => (
                        <option key={id} value={id}>
                          {nameOf(id)}
                        </option>
                      ))}
                    </select>
                  )}
                  <select aria-label={`Space to move ${row.name} to`} value={mode.to} onChange={(e) => open && setOpen({ ...open, mode: { ...mode, to: (e.target as HTMLSelectElement).value } })}>
                    {app.spaces.filter((x) => x.id !== mode.from).map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  {(() => {
                    const dest = app.spaceDocs.get(mode.to);
                    const clash = dest ? tagExists(dest, row.name) : false;
                    return clash ? (
                      <span class="row" role="group" aria-label="Name clash">
                        <span role="status">{nameOf(mode.to)} already has “{row.name}”.</span>
                        <label class="check">
                          <input type="radio" name={`clash-${row.key}`} checked={mode.as === null} onChange={() => open && setOpen({ ...open, mode: { ...mode, as: null } })} />
                          <span>Merge into it</span>
                        </label>
                        <label class="check">
                          <input type="radio" name={`clash-${row.key}`} checked={mode.as !== null} onChange={() => open && setOpen({ ...open, mode: { ...mode, as: `${row.name} 2` } })} />
                          <span>New name</span>
                        </label>
                        {mode.as !== null && <input type="text" aria-label="New tag name in the other space" value={mode.as} onInput={(e) => open && setOpen({ ...open, mode: { ...mode, as: (e.target as HTMLInputElement).value } })} />}
                      </span>
                    ) : null;
                  })()}
                  <Button variant="primary" disabled={!mode.to || (mode.as !== null && !mode.as.trim())} onClick={() => moveToSpace(row, mode)}>
                    Move
                  </Button>
                  <Button onClick={() => setOpen(null)}>Cancel</Button>
                </div>
              </div>
            )}
            {mode?.kind === 'items' && (
              <div class="tag-panel">
                {itemsOf(row).length === 0 ? (
                  <p class="muted">Nothing has this tag.</p>
                ) : (
                  itemsOf(row).map((g) => (
                    <div key={g.source}>
                      <strong>{g.source}</strong>
                      <ul class="tag-items">
                        {g.items.map((i) => (
                          <li key={i.id}>{i.open ? <button type="button" class="link-btn" onClick={i.open}>{i.label}</button> : i.label}</li>
                        ))}
                      </ul>
                    </div>
                  ))
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * One tag list across entries, notes and tasks for the spaces given: open a tag's items, hide it
 * from pickers, rename or merge it, or remove it. With several spaces a tag name is one row with
 * per-space counts, and hide, rename and remove ask which spaces (all by default).
 */
export function TagManager({ spaceIds, selection }: { spaceIds: string[]; selection?: SelectionApi }) {
  const app = useApp();
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const bump = (): void => setVersion((v) => v + 1);
    const docs = [...app.spaceDocs.values(), ...app.privateDocs.values()];
    for (const d of docs) d.on('update', bump);
    return () => {
      for (const d of docs) d.off('update', bump);
    };
  }, [app.spaceDocs, app.privateDocs]);
  return (
    <div class="tag-manager">
      <p class="hint">
        One list for time entries, notes and tasks. Hiding a tag only takes it off the pickers; it still shows on items and in reports. Rename and remove change every item that has the tag.
      </p>
      <Tags spaceIds={spaceIds} version={version} selection={selection} />
    </div>
  );
}
