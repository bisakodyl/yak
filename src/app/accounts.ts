import { accountLabel } from '../core/account-labels';
import type { ShareView } from './shares-runtime';
import type * as Y from 'yjs';

/**
 * The other accounts this account shares with, worked out from the shares it takes part in (#334). Every share is
 * per space; this only groups them by account for Settings. Nothing here is stored except your own label
 * (`account-labels.ts`).
 */

export interface SharedSpace {
  space: string;
  name: string;
}

export interface OtherAccount {
  fp: string;
  /** The name the account chose when it joined or shared (from the roster), if any. */
  chosen: string | undefined;
  /** Your label, else the chosen name, else "Another account". */
  label: string;
  /** Spaces you own that this account is a member of. */
  youShare: SharedSpace[];
  /** Spaces that account (or its owner) shares with you. */
  sharesWithYou: SharedSpace[];
}

export const ANOTHER_ACCOUNT = 'Another account';

/** Display name of an account: your label, else the name it chose, else a fixed phrase. */
export function accountName(account: Y.Doc | undefined, fp: string, chosen?: string): string {
  return accountLabel(account, fp) ?? chosen ?? ANOTHER_ACCOUNT;
}

export function otherAccounts(
  account: Y.Doc | undefined,
  ownFp: string | undefined,
  spaces: { id: string; name: string }[],
  viewOf: (space: string) => ShareView | undefined,
): OtherAccount[] {
  const out = new Map<string, OtherAccount>();
  for (const s of spaces) {
    const view = viewOf(s.id);
    if (!view?.active || !view.state) continue;
    for (const m of view.state.members.values()) {
      if (m.fp === ownFp) continue;
      let a = out.get(m.fp);
      if (!a) {
        a = { fp: m.fp, chosen: undefined, label: ANOTHER_ACCOUNT, youShare: [], sharesWithYou: [] };
        out.set(m.fp, a);
      }
      if (m.name && !a.chosen) a.chosen = m.name;
      (view.owner ? a.youShare : a.sharesWithYou).push({ space: s.id, name: s.name });
    }
  }
  const list = [...out.values()];
  for (const a of list) a.label = accountName(account, a.fp, a.chosen);
  return list.sort((x, y) => x.label.localeCompare(y.label));
}

/** The accounts of one space other than this one, with the label you would see for each. */
export function spaceAccounts(account: Y.Doc | undefined, ownFp: string | undefined, view: ShareView | undefined): { fp: string; label: string; owner: boolean }[] {
  if (!view?.active || !view.state) return [];
  return [...view.state.members.values()]
    .filter((m) => m.fp !== ownFp)
    .map((m) => ({ fp: m.fp, label: accountName(account, m.fp, m.name), owner: m.fp === view.state!.owner }));
}
