import { useMemo, useState } from 'preact/hooks';
import { Button, Pill } from '../app/ui';
import { type DetailSortKey, NO_DESCRIPTION, sortDetailRows } from './aggregate';
import { clockTime, formatDuration, formatMoney } from './format';
import { Scroll, type ViewData } from './parts';

const PAGE = 500;

const COLUMNS: { key: DetailSortKey; label: string; num?: boolean }[] = [
  { key: 'date', label: 'Date' },
  { key: 'description', label: 'Description' },
  { key: 'project', label: 'Project' },
  { key: 'tags', label: 'Tags' },
  { key: 'duration', label: 'Duration', num: true },
  { key: 'amount', label: 'Amount', num: true },
];

export function DetailedView({ report, format }: ViewData) {
  const [sort, setSort] = useState<{ key: DetailSortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' });
  const [shown, setShown] = useState(PAGE);
  const rows = useMemo(() => sortDetailRows(report.rows, sort.key, sort.dir), [report.rows, sort]);

  const onSort = (key: DetailSortKey): void => {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' || key === 'duration' || key === 'amount' ? 'desc' : 'asc' }));
  };

  return (
    <div>
      {rows.length === 0 ? (
        <p class="empty">No entries in this range with these filters.</p>
      ) : (
        <>
          <p class="hint" role="status">
            {rows.length} {rows.length === 1 ? 'entry' : 'entries'}. An entry that crosses the edge of the range shows only the time inside it.
          </p>
          <Scroll label="Entries table">
            <table class="rp-table rp-detail">
              <caption class="rp-sr">Time entries, sortable by column</caption>
              <thead>
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c.key} scope="col" class={c.num ? 'rp-num' : ''} aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                      <Button class="rp-sort" onClick={() => onSort(c.key)}>
                        {c.label}
                        <span aria-hidden="true">{sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''}</span>
                      </Button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((r) => (
                  <tr key={`${r.spaceId}/${r.id}`}>
                    <td class="rp-nowrap">
                      {r.day}
                      <div class="rp-sub">
                        {clockTime(r.startMs)}–{r.running ? 'now' : clockTime(r.endMs)}
                      </div>
                    </td>
                    <td>
                      {r.description.trim() ? r.description : <span class="rp-sub">{NO_DESCRIPTION}</span>}
                      {r.billable && <Pill class="rp-badge">billable</Pill>}
                    </td>
                    <td>
                      {r.projectLabel}
                      {r.clientLabel.startsWith('(') ? null : <div class="rp-sub">{r.clientLabel}</div>}
                    </td>
                    <td>
                      {r.tags.map((t) => (
                        <Pill key={t} class="rp-tag">
                          {t}
                        </Pill>
                      ))}
                    </td>
                    <td class="rp-num rp-nowrap">{formatDuration(r.ms, format)}</td>
                    <td class="rp-num rp-nowrap">{r.amount === null ? '—' : formatMoney(r.amount, r.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Scroll>
          {rows.length > shown && (
            <div class="row">
              <Button onClick={() => setShown(shown + PAGE)}>
                Show {Math.min(PAGE, rows.length - shown)} more
              </Button>
              <span class="hint">Showing {shown} of {rows.length}.</span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
