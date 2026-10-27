import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { isFeatureHidden } from '../app/features';
import { scheduleErase } from '../app/leave';
import { navigate } from '../app/router';
import { safeStorage } from '../app/join';
import type { ViewProps } from '../app/registry';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button, Field, Page, PageHeader } from '../app/ui';
import { SharePanel } from '../app/views/SharePanel';
import { removeSpace, renameSpace, setArchived, spacesMap } from '../core/account';
import { decided, keeps, keepsMap, setKeeps } from '../core/keeps';
import { useDeviceColumns, lastSeen } from './device-columns';
import { EDIT_WARNING } from './OtherAccounts';

/** Live notes and time entries of a space, as far as this device holds them (undefined: not kept here). */
function countsOf(spaceDoc: Y.Doc | undefined, privateDoc: Y.Doc | undefined): { notes: number; entries: number } | undefined {
  if (!spaceDoc || !privateDoc) return undefined;
  const live = (m: Y.Map<unknown>): number => [...m.values()].filter((v) => !(v as Y.Map<unknown>).get('deleted')).length;
  return { notes: live(spaceDoc.getMap('notes')), entries: live(privateDoc.getMap('time_entries')) };
}

/**
 * A space's detail view, `#/settings/space/<id>` (F-326): rename, archive, remove (or Leave for a space
 * someone shared with you), Kept on (the devices, #334), Shared with (accounts, an open link, a new share), and its files. Names are unique in the account.
 */
export function SpaceView({ params }: ViewProps) {
  const { account, allSpaces, spaceDocs, privateDocs, sync } = useApp();
  useShares();
  const { columns, localOnly } = useDeviceColumns();
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(spacesMap(account) as unknown as Y.AbstractType<unknown>);
  const s = allSpaces.find((x) => x.id === params[0]);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState(false);
  const [erase, setErase] = useState(false);
  const back = (
    <p class="hint">
      <a href="#/settings">← Settings</a>
    </p>
  );
  if (!s) {
    return (
      <Page width="settings" class="st">
        <PageHeader title="Space" />
        {back}
        <p class="empty">This space is not in your account.</p>
      </Page>
    );
  }
  const share = shares.view(s.id);
  const member = !!share && share.active && !share.owner;
  const counts = countsOf(spaceDocs.get(s.id), privateDocs.get(s.id));

  const confirmRemove = async (): Promise<void> => {
    const problem = removeSpace(account, s.id);
    setError(problem ?? '');
    setRemoving(false);
    if (problem) return;
    if (!erase) {
      navigate('settings');
      return;
    }
    scheduleErase(safeStorage(), [s.id]);
    if (sync.status.peers.some((p) => p.state === 'connected')) await new Promise((r) => setTimeout(r, 1500));
    location.hash = '#/settings';
    location.reload();
  };

  return (
    <Page width="settings" class="st st-space">
      <PageHeader title={s.name} />
      {back}
      <h2 id="kept-on-h">Kept on</h2>
      <div class="card st-group">
        <p class="hint">
          {localOnly
            ? `${s.name} lives on this device. Add a device to keep it on another one too.`
            : `Tick the devices that keep ${s.name}. Unticking stops that device receiving it from now on; what it already has stays on it.`}
        </p>
        <ul class="st-kept" aria-labelledby="kept-on-h">
          {columns.map((c) => (
            <li key={c.id} data-kept-device={c.here ? 'this' : c.id}>
              <label class="st-keep-row">
                <input
                  type="checkbox"
                  checked={keeps(account, c.id, s.id)}
                  indeterminate={!decided(account, c.id, s.id)}
                  aria-label={`${c.who} keeps ${s.name}`}
                  onChange={(e) => setKeeps(account, c.id, s.id, (e.target as HTMLInputElement).checked)}
                />
                <span>
                  {c.label}
                  {c.here ? null : <span class="hint st-account-sub">{lastSeen(c.peer)}</span>}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <h2>Shared with</h2>
      <p class="hint">Time entries and rates are never shared. {EDIT_WARNING}</p>
      <div class="card">
        <SharePanel space={s.id} name={s.name} hideTitle />
      </div>

      {isFeatureHidden('notes') ? null : (
        <>
          <h2>Files</h2>
          <p class="hint">
            Attached files and the ones no note refers to are listed in <a href="#/note-settings">Note settings</a>.
          </p>
        </>
      )}
      <h2>Space</h2>
      <div class="card st-group">
        <Field layout="split" class="st-field" label="Space name">
          <input
            type="text"
            aria-label={`Name of space ${s.name}`}
            defaultValue={s.storedName}
            key={s.storedName}
            maxLength={60}
            onChange={(e) => {
              const input = e.target as HTMLInputElement;
              const problem = renameSpace(account, s.id, input.value);
              setError(problem ?? '');
              if (problem) input.value = s.storedName;
            }}
          />
        </Field>
        {error ? <p class="error">{error}</p> : null}
        {s.archived && <p class="hint">Archived: hidden from pickers and lists, still synced and kept.</p>}
        <div class="row">
          <Button onClick={() => setError(setArchived(account, s.id, !s.archived) ?? '')}>{s.archived ? `Unarchive ${s.name}` : `Archive ${s.name}`}</Button>
          {member ? null : (
            <Button variant="danger" onClick={() => setRemoving(!removing)}>{`Remove ${s.name}`}</Button>
          )}
        </div>
        {removing && !member && (
          <div class="confirm-panel" role="group" aria-label={`Remove ${s.name}`}>
            <p>
              <strong>Remove {s.name} from the account?</strong> Every device stops keeping it and it disappears from the lists. The data stays in backups and history.
            </p>
            <p role="status">
              {counts
                ? `${s.name} holds ${counts.notes} note${counts.notes === 1 ? '' : 's'} and ${counts.entries} time ${counts.entries === 1 ? 'entry' : 'entries'} on this device. They are left without a space.`
                : `This device does not keep ${s.name}, so it cannot count its notes and entries. Anything in it is left without a space.`}
            </p>
            <label>
              <input type="checkbox" checked={erase} onChange={(e) => setErase((e.target as HTMLInputElement).checked)} /> Also erase this device's copy (other devices keep theirs)
            </label>
            <div class="row">
              <Button variant="danger" onClick={() => void confirmRemove()}>
                Remove {s.name} from the account
              </Button>
              <Button onClick={() => setRemoving(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>

    </Page>
  );
}
