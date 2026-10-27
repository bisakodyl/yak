import type * as Y from 'yjs';

/**
 * Names you give other accounts, and when a share began (#334). Both live in this account's own document
 * (`settings` map), so every device of the account shows the same. Neither is part of a share's roster: the
 * share protocol is unchanged and the other account never sees them. An absent key reads as "no label" /
 * "date unknown", so older documents need no migration (F39).
 */

const LABEL_MAX = 80;
const FP = /^[a-f0-9]{32}$/;
const SPACE = /^[a-f0-9]{24}$/;

const labelKey = (fp: string): string => `account_label:${fp}`;
const sinceKey = (space: string, fp: string): string => `share_since:${space}:${fp}`;
const settings = (account: Y.Doc): Y.Map<unknown> => account.getMap<unknown>('settings');

/** Your own name for the account with this fingerprint, or undefined. */
export function accountLabel(account: Y.Doc | undefined, fp: string): string | undefined {
  const v = account?.getMap<unknown>('settings').get(labelKey(fp));
  return typeof v === 'string' && v.trim() ? v.slice(0, LABEL_MAX) : undefined;
}

/** Set your name for an account; empty text removes it (the name the account chose is shown again). */
export function setAccountLabel(account: Y.Doc, fp: string, label: string): void {
  if (!FP.test(fp)) return;
  const clean = label.replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX);
  if (clean) settings(account).set(labelKey(fp), clean);
  else settings(account).delete(labelKey(fp));
}

/** When this account first shared the space with `fp` (ISO text), or undefined when unknown. */
export function sharedSince(account: Y.Doc | undefined, space: string, fp: string): string | undefined {
  const v = account?.getMap<unknown>('settings').get(sinceKey(space, fp));
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

/** Remember when a share with `fp` began; the first date stays. */
export function noteSharedSince(account: Y.Doc, space: string, fp: string, at = new Date().toISOString()): void {
  if (!FP.test(fp) || !SPACE.test(space) || sharedSince(account, space, fp)) return;
  settings(account).set(sinceKey(space, fp), at);
}
