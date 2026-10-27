import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { HealthItem } from '../core/health';
import { useApp } from './context';
import { useHealth } from './hooks';
import { Popover } from './ui';

export interface DataStatusProps {
  /** The shell's own items (sync); modules add theirs through `core/health.ts`. */
  own: readonly HealthItem[];
  /** Merges worth a look (`core/notices.ts`): the dot carries a mark. */
  pendingNotices: number;
}

/**
 * The one data-status dot in the header: green when everything is safe, amber when something is
 * missing, old or broken. A click lists what is wrong, with links to where it is fixed.
 */
const isError = (e: { kind: string }): boolean => e.kind === 'error' || e.kind.startsWith('error:');

export function DataStatus({ own, pendingNotices }: DataStatusProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);
  const id = useId();
  const items = [...useHealth(), ...own];
  const { sync } = useApp();
  const [errors, setErrors] = useState(() => sync.log.all().some(isError));
  useEffect(() => sync.log.subscribe((e) => isError(e) && setErrors(true)), [sync]);
  const warn = items.some((i) => i.level === 'warn');
  const label = warn ? 'Backup and sync: needs attention' : 'Backup and sync: all safe';
  const go = (href: string): void => {
    setOpen(false);
    location.hash = href;
  };
  return (
    <>
      <button
        type="button"
        ref={anchor}
        class={`status-dot-btn ${warn ? 'warn' : 'ok'}`}
        aria-label={label}
        title={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen(!open)}
      >
        <span class="status-dot" aria-hidden="true" />
        {pendingNotices > 0 && <span class="notice-dot" role="img" aria-label={`${pendingNotices} merges worth a look`} />}
      </button>
      <Popover id={id} open={open} anchor={anchor} onClose={() => setOpen(false)} label="Backup and sync" align="end" class="status-panel">
        {items.length === 0 ? <p class="status-ok">Everything is safe.</p> : null}
        <ul class="status-list">
          {items.map((item, i) => (
            <li key={i} class={item.level}>
              <span>{item.text}</span>
            </li>
          ))}
        </ul>
        <div class="status-links">
          <a href="#/settings/backup" onClick={(e) => { e.preventDefault(); go('#/settings/backup'); }}>Backups</a>
          <a href="#/settings/devices" onClick={(e) => { e.preventDefault(); go('#/settings/devices'); }}>Devices</a>
          {errors && (
            <a href="#/help/report" onClick={(e) => { e.preventDefault(); go('#/help/report'); }}>Report a problem</a>
          )}
        </div>
      </Popover>
    </>
  );
}
