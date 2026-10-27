import { useState } from 'preact/hooks';
import type * as Y from 'yjs';
import { keyTrust } from '../app/account-keys-runtime';
import { otherAccounts } from '../app/accounts';
import { useApp } from '../app/context';
import { useYVersion } from '../app/hooks';
import { shares } from '../app/shares-runtime';
import { useShares } from '../app/use-shares';
import { Button } from '../app/ui';
import { formatFingerprint } from '../core/keys';
import { ShareSheet } from './ShareSheet';

/** What a list row says about the shares with one account. */
function summary(youShare: number, withYou: number): string {
  const parts: string[] = [];
  if (youShare) parts.push(`you share ${youShare} ${youShare === 1 ? 'space' : 'spaces'}`);
  if (withYou) parts.push(`shares ${withYou} with you`);
  return parts.join(' · ');
}

export const EDIT_WARNING = 'Other accounts can edit and delete in what you share, and data cannot be taken back.';

/**
 * The Other accounts list on Settings (#334): every account this account shares a space with, or has one shared by,
 * with your label for it and a short fingerprint. A row opens the account's page. The button starts the normal
 * link flow for a space you choose.
 */
export function OtherAccounts() {
  const { account, allSpaces } = useApp();
  useShares();
  useYVersion(account.getMap('settings') as unknown as Y.AbstractType<unknown>);
  const [sharing, setSharing] = useState(false);
  const list = otherAccounts(account, keyTrust.accountFp, allSpaces, (id) => shares.view(id));
  return (
    <section class="st-accounts" aria-labelledby="st-accounts-h">
      <h3 id="st-accounts-h">Other accounts</h3>
      <p class="hint">{EDIT_WARNING}</p>
      {list.length === 0 ? (
        <p class="hint">Nothing is shared with another account.</p>
      ) : (
        <ul class="st-account-list">
          {list.map((a) => (
            <li key={a.fp} data-account={a.fp}>
              <a class="st-account-row" href={`#/settings/account/${a.fp}`}>
                <span class="st-account-main">
                  <span>
                    <strong>{a.label}</strong> <code class="hint">{formatFingerprint(a.fp, 2)}</code>
                  </span>
                  <span class="hint st-account-sub">{summary(a.youShare.length, a.sharesWithYou.length)}</span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
      <div class="row">
        <Button onClick={() => setSharing(true)}>+ Share with an account</Button>
      </div>
      {sharing ? <ShareSheet onClose={() => setSharing(false)} /> : null}
    </section>
  );
}
