import { useEffect, useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { useApp } from '../app/context';
import { Button } from '../app/ui';
import { accountLogDocId } from '../core/account';
import { spaceLogDocId } from '../core/doc-store';
import { linesToText, readLines } from '../sync/shared-log';

const MAX_SHOWN = 400;

/**
 * Every device's debug lines (connection and sync events, no note or entry contents), merged by
 * time. The account log reaches all devices; a space's log only the devices that keep the space.
 */
export function LogsPanel(props: { label(device: string): string }) {
  const { store, accountId, spaces, deviceId } = useApp();
  const [, setTick] = useState(0);
  const [device, setDevice] = useState('');
  const ids = [accountLogDocId(accountId), ...spaces.map((s) => spaceLogDocId(s.id))];
  const key = ids.join();

  useEffect(() => {
    let alive = true;
    const docs: Y.Doc[] = [];
    const bump = (): void => setTick((t) => t + 1);
    for (const id of key.split(',')) {
      void store.open(id).then((d) => {
        if (!alive) return;
        docs.push(d);
        d.on('update', bump);
        bump();
      });
    }
    return () => {
      alive = false;
      for (const d of docs) d.off('update', bump);
    };
  }, [store, key]);

  const docs = ids.map((id) => store.get(id)).filter((d): d is Y.Doc => d !== undefined);
  const all = readLines(docs);
  const people = [...new Set(all.map((l) => l.device))];
  const shown = (device ? all.filter((l) => l.device === device) : all).slice(-MAX_SHOWN);
  const text = linesToText(shown, props.label);
  return (
    <div class="logs-panel">
      <p class="hint">
        Connection and sync events from every device of this account, last 7 days; no note or entry contents. Addresses used to connect may appear: share
        them only with yourself.
      </p>
      <div class="row">
        <label>
          Device{' '}
          <select aria-label="Filter logs by device" value={device} onChange={(e) => setDevice((e.target as HTMLSelectElement).value)}>
            <option value="">All devices</option>
            {people.map((d) => (
              <option key={d} value={d}>
                {d === deviceId ? `${props.label(d)} (this device)` : props.label(d)}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void navigator.clipboard?.writeText(text)}>Copy report</Button>
      </div>
      <pre class="log" aria-label="Shared log">{text}</pre>
    </div>
  );
}
