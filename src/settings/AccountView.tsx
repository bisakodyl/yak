import type * as Y from 'yjs';
import { useState } from 'preact/hooks';
import { keyTrust } from '../app/account-keys-runtime';
import { otherAccounts, type SharedSpace } from '../app/accounts';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { withKey } from '../app/key-prompt';
import type { ViewProps } from '../app/registry';
import { shareLinks } from '../app/share-links';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button, Field, Page, PageHeader } from '../app/ui';
import { setAccountLabel, sharedSince } from '../core/account-labels';
import { formatFingerprint } from '../core/keys';
import { EDIT_WARNING } from './OtherAccounts';
import { ShareSheet, shareableSpaces } from './ShareSheet';

type Pending = { kind: 'end' | 'leave'; space: SharedSpace };

/**
 * An account's page, `#/settings/account/<fingerprint>` (#334): its full fingerprint, your name for it, the spaces
 * you share with it (End…), the spaces it shares with you (Leave…) and "+ Share another space". Every share is still per
 * space, with its own one-time link and code comparison; nothing here changes the protocol.
 */
export function AccountView({ params }: ViewProps) {
  const { account, allSpaces } = useApp();
  useShares();
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const fp = params[0] ?? '';
  const a = otherAccounts(account, keyTrust.accountFp, allSpaces, (id) => shares.view(id)).find((x) => x.fp === fp);
  const [draft, setDraft] = useState<string | undefined>();
  const [sharing, setSharing] = useState(false);
  const [pending, setPending] = useState<Pending | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const back = (
    <p class="hint">
      <a href="#/settings">← Settings</a>
    </p>
  );
  if (!a) {
    return (
      <Page width="settings" class="st st-account">
        <PageHeader title="Account" />
        {back}
        <p class="empty">Nothing is shared with this account now.</p>
      </Page>
    );
  }

  const run = (job: () => Promise<unknown>): void => {
    setError('');
    setBusy(true);
    void job()
      .then((ran) => (ran === false ? undefined : setPending(undefined)))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const text = draft ?? a.label;
  const canShare = shareableSpaces(allSpaces, fp).length > 0;

  return (
    <Page width="settings" class="st st-account">
      <PageHeader title={a.label} />
      {back}
      <div class="card st-group">
        <p>
          Fingerprint <code data-account-fingerprint>{formatFingerprint(fp, 8)}</code>
        </p>
        <p class="hint">It identifies the account. Compare it with them if you want to be sure who this is.</p>
        <form
          class="row"
          onSubmit={(e) => {
            e.preventDefault();
            setAccountLabel(account, fp, text === a.chosen ? '' : text);
            setDraft(undefined);
          }}
        >
          <Field layout="split" class="st-field" label="Your name for it">
            <input type="text" aria-label="Your name for this account" value={text} maxLength={80} placeholder={a.chosen ?? 'Another account'} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} />
          </Field>
          <Button type="submit">Rename</Button>
        </form>
        <p class="hint">{a.chosen ? `It chose the name "${a.chosen}". ` : 'It gave no name. '}Only your devices see this name.</p>
      </div>

      <p class="hint st-warning" data-edit-warning>
        {EDIT_WARNING}
      </p>
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}

      <h2>You share with {a.label}</h2>
      <div class="card st-group">
        {a.youShare.length === 0 ? <p class="hint">No space of yours is shared with {a.label}.</p> : null}
        <ul class="st-share-list">
          {a.youShare.map((sp) => {
            const since = sharedSince(account, sp.space, fp);
            return (
              <li key={sp.space} data-shared-space={sp.space}>
                <span class="share-member-main">
                  <a href={`#/settings/space/${sp.space}`}>
                    <strong>{sp.name}</strong>
                  </a>
                  {since ? <span class="hint st-account-sub">Since {new Date(since).toLocaleDateString()}</span> : null}
                </span>
                <Button aria-label={`End ${sp.name} share with ${a.label}`} onClick={() => setPending({ kind: 'end', space: sp })}>
                  End…
                </Button>
              </li>
            );
          })}
        </ul>
        {pending?.kind === 'end' ? (
          <div class="confirm-panel" role="group" aria-label="End the share">
            <p>
              <strong>End sharing {pending.space.name} with {a.label}?</strong> Nothing more is exchanged with them. They keep what they have so far, and so do you. Deleting anything here never deletes it there from now on. They can be added again with a new link.
            </p>
            <div class="row">
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => run(() => withKey({ verb: `end the share with ${a.label}`, run: () => shares.end(pending.space.space, fp) }))}
              >
                End share
              </Button>
              <Button onClick={() => setPending(undefined)}>Cancel</Button>
            </div>
          </div>
        ) : null}
        <div class="row">
          {canShare ? (
            <Button onClick={() => setSharing(true)}>+ Share another space</Button>
          ) : (
            <p class="hint">Every space you own is already shared with {a.label}.</p>
          )}
        </div>
      </div>

      {a.sharesWithYou.length > 0 ? (
        <>
          <h2>{a.label} shares with you</h2>
          <div class="card st-group">
            <ul class="st-share-list">
              {a.sharesWithYou.map((sp) => {
                const since = sharedSince(account, sp.space, fp);
                return (
                  <li key={sp.space} data-shares-with-you={sp.space}>
                    <span class="share-member-main">
                      <a href={`#/settings/space/${sp.space}`}>
                        <strong>{sp.name}</strong>
                      </a>
                      {since ? <span class="hint st-account-sub">Since {new Date(since).toLocaleDateString()}</span> : null}
                    </span>
                    <Button aria-label={`Leave ${sp.name}`} onClick={() => setPending({ kind: 'leave', space: sp })}>
                      Leave…
                    </Button>
                  </li>
                );
              })}
            </ul>
            {pending?.kind === 'leave' ? (
              <div class="confirm-panel" role="group" aria-label="Leave the share">
                <p>
                  <strong>Leave {pending.space.name}?</strong> {pending.space.name} stays here as your own space, with what it holds now. Nothing more is exchanged; the others keep their copies too. The owner can add you again with a new link.
                </p>
                <div class="row">
                  <Button variant="danger" disabled={busy} onClick={() => run(() => shareLinks.leave(pending.space.space))}>
                    Leave
                  </Button>
                  <Button onClick={() => setPending(undefined)}>Cancel</Button>
                </div>
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      {sharing ? <ShareSheet without={fp} onClose={() => setSharing(false)} /> : null}
    </Page>
  );
}
