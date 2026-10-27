import type * as Y from 'yjs';
import { useEffect, useState } from 'preact/hooks';
import type { ComponentType } from 'preact';
import { ownerKeys } from '../app/account-keys-runtime';
import { useApp } from '../app/context';
import { dataLines } from '../app/data-lines';
import { useSyncStatus, useYVersion } from '../app/hooks';
import { useKeyTrust } from '../app/key-hooks';
import { keyPrompt, withKey } from '../app/key-prompt';
import { Button, DataLine } from '../app/ui';
import { deviceName } from '../core/devices';
import { readAccountEncryption } from '../core/account-encryption';

/** The passphrase line: locked, or unlocked with the minutes left (the unlock slides, F-324). Shown whenever the device has a passphrase or the account requires device keys; "Manage" opens its section in Backup & restore. */
function PassphraseLine() {
  const { account } = useApp();
  const trust = useKeyTrust();
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000);
    const stop = keyPrompt.subscribe(() => setTick((n) => n + 1));
    return () => {
      clearInterval(t);
      stop();
    };
  }, []);
  const has = !!readAccountEncryption(account);
  if (!has && !trust.required()) return null;
  const left = Math.ceil(ownerKeys.current.unlockedLeft() / 60_000);
  const open = (): void => void withKey({ verb: 'continue', run: async () => undefined }).then(() => setTick((n) => n + 1), () => undefined);
  const text = !has ? 'Not set' : left > 0 ? `Unlocked · ${left} min` : 'Locked';
  return (
    <DataLine id="passphrase" tone={!has ? 'off' : left > 0 ? 'ok' : 'warn'} label="Passphrase" text={text}>
      {!has ? (
        <Button variant="link" onClick={open}>
          Create…
        </Button>
      ) : (
        <>
          {left > 0 ? null : (
            <>
              <Button variant="link" onClick={open}>
                Unlock…
              </Button>
              {' · '}
            </>
          )}
          <a href="#/settings/backup/passphrase">Manage</a>
        </>
      )}
    </DataLine>
  );
}

/** The sync line: who this device is syncing with, linking to the device views. Only a device that syncs has one. */
function SyncLine() {
  const { sync, account } = useApp();
  const status = useSyncStatus(sync);
  if (!status.paired) return null;
  const names = status.peers.filter((p) => p.state === 'connected').map((p) => deviceName(account, p.id) ?? 'an unnamed device');
  const text = names.length > 0 ? `Syncing with ${names.join(', ')}` : status.peers.length === 0 ? 'On · waiting for your first device' : 'On · waiting for your other devices';
  return (
    <DataLine id="sync" tone={names.length > 0 ? 'ok' : 'off'} label="Sync" text={text}>
      <a href="#/settings/devices">Devices</a>
    </DataLine>
  );
}

const OWN: { id: string; order: number; component: ComponentType }[] = [
  { id: 'passphrase', order: 20, component: PassphraseLine },
  { id: 'sync', order: 30, component: SyncLine },
];

/** The status lines under the table: backup, passphrase, sync and whatever modules registered (`registerDataLine`), each ending in a link. */
export function DataLines() {
  const all = [...dataLines(), ...OWN].sort((a, b) => a.order - b.order);
  return (
    <div class="st-lines" aria-label="Status">
      {all.map((l) => (
        <l.component key={l.id} />
      ))}
    </div>
  );
}
