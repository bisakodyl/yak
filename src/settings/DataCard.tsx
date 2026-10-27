import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { accountName } from '../app/accounts';
import { keyTrust } from '../app/account-keys-runtime';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { linkSettled, shareLinks } from '../app/share-links';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button } from '../app/ui';
import { UndecidedNotice } from '../app/views/UndecidedNotice';
import { createSpace, spacesMap } from '../core/account';
import { decided, keeps, keepsMap, setKeeps } from '../core/keeps';
import { DataLines } from './DataLines';
import { useDeviceColumns } from './device-columns';
import { OtherAccounts } from './OtherAccounts';

/** Chips for a space's shares: the accounts it is shared with ("Studio"), or who shared it with you ("from Alice"). */
function shareChips(account: Y.Doc, space: string): string[] {
  const view = shares.view(space);
  if (!view?.active || !view.state) return [];
  const own = keyTrust.accountFp;
  if (view.owner) return [...view.state.members.values()].filter((m) => m.fp !== own).map((m) => accountName(account, m.fp, m.name));
  const owner = view.state.members.get(view.state.owner);
  return [`from ${accountName(account, view.state.owner, owner?.name)}`];
}

/**
 * The Your data card (F-326): rows are spaces, columns are devices (this one first), a cell is whether that device keeps
 * that space. A space name opens the space, whose page lists who it is shared with; the header "+" adds a device. Under the
 * table come the Other accounts list (#334) and the status lines (backup, passphrase, sync). A device that never paired has one column.
 */
export function DataCard() {
  const { account, allSpaces, deviceId } = useApp();
  const { columns, localOnly } = useDeviceColumns();
  useShares();
  useYVersion(keepsMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(spacesMap(account) as unknown as Y.AbstractType<unknown>);
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);

  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newError, setNewError] = useState('');

  return (
    <section class="card st-card st-data" aria-labelledby="st-data-h">
      <h2 id="st-data-h">Your data</h2>
      <p class="hint">
        {localOnly
          ? 'Your spaces live on this device. Add a device to keep them on another one too.'
          : 'Tick the spaces each device keeps. Unticking stops that device receiving a space from now on; what it already has stays on it.'}
      </p>

      <UndecidedNotice />

      <div class="st-table-wrap" role="region" aria-label="Spaces and the devices that keep them" tabIndex={0}>
        <table class="st-keeps">
          <thead>
            <tr>
              <th scope="col">Space</th>
              {columns.map((c) => (
                <th key={c.id} scope="col" class="st-device-col" data-device-col={c.here ? 'this' : c.id}>
                  <a href={c.here ? '#/settings/devices' : `#/settings/devices/${c.id}`} title={c.label}>
                    {c.label}
                  </a>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {allSpaces.map((s) => {
              const chips = shareChips(account, s.id);
              const linkOpen = shareLinks.hosting?.space === s.id && !linkSettled(shareLinks.hosting);
              // Someone who used the link and waits for an answer: say so here, not only on the space's page.
              const asking = shareLinks.hosting?.space === s.id ? shareLinks.hosting.requests.filter((r) => r.state === 'waiting') : [];
              return (
                <tr key={s.id} data-space={s.id}>
                  <th scope="row">
                    <a class="st-space-link" href={`#/settings/space/${s.id}`}>
                      {s.name}
                    </a>
                    {s.archived ? <span class="hint"> (archived)</span> : null}
                    <div class="st-chips">
                      {chips.map((n, i) => (
                        <span key={i} class="st-chip" data-chip>
                          {n}
                        </span>
                      ))}
                      {asking.map((r) => (
                        <span key={r.ask.deviceId} class="st-chip st-chip-ask" data-chip data-share-request>
                          {r.ask.name ?? 'Another account'} asks to join · <a href={`#/settings/space/${s.id}`}>Review</a>
                        </span>
                      ))}
                      {linkOpen && asking.length === 0 ? <span class="st-chip" data-chip>link open</span> : null}
                    </div>
                  </th>
                  {columns.map((c) => (
                    <td key={c.id} class="st-cell">
                      <label class="st-keep">
                        <input
                          type="checkbox"
                          checked={keeps(account, c.id, s.id)}
                          indeterminate={!decided(account, c.id, s.id)}
                          aria-label={`${c.who} keeps ${s.name}`}
                          onChange={(e) => setKeeps(account, c.id, s.id, (e.target as HTMLInputElement).checked)}
                        />
                      </label>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
        {allSpaces.length === 0 ? <p class="hint">No spaces yet. If this device just joined, they arrive by themselves: keep Yak open on one of your other devices.</p> : null}
      </div>

      <div class="row st-actions">
        {adding ? (
          <>
            <input
              type="text"
              aria-label="New space name"
              placeholder="Name of the new space"
              value={newName}
              maxLength={60}
              onInput={(e) => setNewName((e.target as HTMLInputElement).value)}
            />
            <Button
              variant="primary"
              onClick={() => {
                const result = createSpace(account, newName, deviceId);
                if ('error' in result) setNewError(result.error);
                else {
                  setNewError('');
                  setNewName('');
                  setAdding(false);
                }
              }}
            >
              Create space
            </Button>
            <Button onClick={() => { setAdding(false); setNewError(''); }}>Cancel</Button>
          </>
        ) : (
          <Button onClick={() => setAdding(true)}>+ New space</Button>
        )}
        <a class="btn" href="#/settings/devices/add">
          + Add a device
        </a>
      </div>
      {newError ? <p class="error">{newError}</p> : null}

      <OtherAccounts />

      <DataLines />
    </section>
  );
}
