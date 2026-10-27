import { useEffect, useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { Button, Page, PageHeader } from '../app/ui';
import { STORAGE_PREFIX } from '../constants';
import { fetchNetworkStats, type NetworkResult, summarize } from '../sync/network-stats';

const KEY = `${STORAGE_PREFIX}-admin-key`;
const load = (): string => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
};

const mb = (n: number): string => `${(n / (1024 * 1024)).toFixed(1)} MB`;

/**
 * Operator view of relay use (#173). Not in the Settings list: open `#/settings/network`, enter the admin key
 * once on this device (kept in localStorage, never synced). Without the key or the Worker secrets it shows nothing.
 */
export function NetworkStatsView() {
  const { sync } = useApp();
  const [key, setKey] = useState(load());
  const [draft, setDraft] = useState('');
  const [hours, setHours] = useState(24);
  const [result, setResult] = useState<NetworkResult | undefined>();
  useEffect(() => {
    if (!key) return;
    let alive = true;
    void fetchNetworkStats(sync.status.signalingUrl, key, hours).then((r) => alive && setResult(r));
    return () => {
      alive = false;
    };
  }, [sync, key, hours]);
  const summary = result?.ok ? summarize(result.rows) : undefined;
  return (
    <Page width="settings" class="st">
      <PageHeader title="Network stats" />
      {!key ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            try {
              localStorage.setItem(KEY, draft.trim());
            } catch {
              // Kept for this page only.
            }
            setKey(draft.trim());
          }}
        >
          <p class="hint">Operator view of the relay. Enter the admin key set on the Worker. It stays on this device.</p>
          <input type="password" aria-label="Admin key" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} autocomplete="off" />{' '}
          <Button type="submit" disabled={!draft.trim()}>
            Show stats
          </Button>
        </form>
      ) : (
        <>
          <div class="row">
            <label>
              Period{' '}
              <select aria-label="Period" value={hours} onChange={(e) => setHours(Number((e.target as HTMLSelectElement).value))}>
                <option value={24}>Last 24 hours</option>
                <option value={72}>Last 3 days</option>
                <option value={168}>Last 7 days</option>
              </select>
            </label>
            <Button
              onClick={() => {
                try {
                  localStorage.removeItem(KEY);
                } catch {
                  // Nothing stored.
                }
                setKey('');
                setResult(undefined);
              }}
            >
              Forget the key
            </Button>
          </div>
          {!result && <p class="hint">Loading…</p>}
          {result && !result.ok && (
            <p class="error">
              {result.reason === 'key' ? 'The Worker did not accept this key.' : result.reason === 'off' ? 'This relay has no operator stats turned on.' : 'The stats could not be read.'}
            </p>
          )}
          {summary && (
            <>
              <p role="status">
                Active rooms (busiest hour): {summary.peakRooms} · {summary.messages.toLocaleString()} messages · {mb(summary.bytes)} · relay fallback carries{' '}
                {Math.round(summary.linkShare * 100)}% of the bytes
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Hour (UTC)</th>
                    <th>Kind</th>
                    <th>Rooms</th>
                    <th>Messages</th>
                    <th>MB</th>
                  </tr>
                </thead>
                <tbody>
                  {result?.ok &&
                    result.rows.map((r) => (
                      <tr key={r.hour + r.kind}>
                        <td>{r.hour.slice(0, 16)}</td>
                        <td>{r.kind === 'link' ? 'data link (fallback)' : 'signaling'}</td>
                        <td>{r.rooms}</td>
                        <td>{r.messages}</td>
                        <td>{(r.bytes / (1024 * 1024)).toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </Page>
  );
}
