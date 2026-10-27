import { useEffect, useState } from 'preact/hooks';
import { useNow } from '../app/hooks';
import { navigate } from '../app/router';
import { Button } from '../app/ui';
import { reportHealth } from '../core/health';
import { deviceFirstSeen, hasData, remindTomorrow, remindUntil, useBackup } from './runtime';
import { backupHealth, shouldNudge } from './service';

/**
 * Shown on every screen while backups are stale, failing, never made, or folder access was lost.
 * A device that never backed up is left to the dot for its first days, then nudged (`shouldNudge`). "Remind me tomorrow" hides it for a day on this device; the status dot in the header keeps
 * reporting the problem (this component reports it, so the shell needs no backup code).
 */
export function BackupBanner() {
  const { state, store, folder, service } = useBackup();
  const now = useNow(60_000);
  const [until, setUntil] = useState(remindUntil);
  const [firstSeen] = useState(deviceFirstSeen);
  const health = backupHealth(state, now, hasData(store.opened()));
  const text = health.ok ? undefined : health.text;
  useEffect(() => {
    reportHealth('backup', text ? [{ level: 'warn', text }] : []);
  }, [text]);
  if (health.ok && !state.notice) return null;
  if (health.ok) {
    return (
      <div class="backup-banner info" role="status">
        <span>{state.notice}</span>
        <Button onClick={() => service.setNotice(undefined)}>
          Dismiss
        </Button>
      </div>
    );
  }
  // Never backed up is for the status dot alone at first: a fresh device has nothing to lose yet. After a few days of use it becomes a nudge.
  if (now < until || (health.kind === 'never' && !shouldNudge(health, firstSeen, now))) return null;
  return (
    <div class="backup-banner warn" role="alert">
      <span>{health.kind === 'never' ? `Turn on backups: ${health.text}` : health.text}</span>
      {health.kind === 'permission' ? (
        <Button
          onClick={() =>
            void folder.requestAccess().then(async () => {
              await service.refreshFolder();
              await service.run('permission-granted');
            })
          }
        >
          Allow access
        </Button>
      ) : null}
      <Button onClick={() => navigate('settings', 'backup')}>
        Open backups
      </Button>
      <Button variant="quiet" onClick={() => setUntil(remindTomorrow())}>
        Remind me tomorrow
      </Button>
    </div>
  );
}
