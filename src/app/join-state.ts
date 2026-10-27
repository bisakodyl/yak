/**
 * Where a join by code stands (#257), for the pages that show it. Kept apart from `invites.ts`, which
 * loads on demand, so the first load carries only this.
 */

export interface JoinState {
  /** `asking`: waiting for an enrolled device; `compare`: show `compare` and approve on the other device. */
  phase: 'asking' | 'compare' | 'approved' | 'declined' | 'failed';
  compare?: string;
  /** The person confirmed on this device that the codes match. */
  confirmed?: boolean;
  /** Declined because the code already admitted a device. */
  used?: boolean;
  error?: string;
}

const listeners = new Set<() => void>();
let current: JoinState | undefined;

export const joinState = {
  get(): JoinState | undefined {
    return current;
  },
  set(j: JoinState | undefined): void {
    current = j;
    for (const l of listeners) l();
  },
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};

/** Join with a code: loads the invite code on first use. */
export async function joinWithCode(code: string, signalingUrl: string): Promise<void> {
  const { invites } = await import('./invites');
  await invites.joinWithCode(code, signalingUrl);
}

/** The person saw the same code on both screens. */
export async function confirmJoin(): Promise<void> {
  (await import('./invites')).invites.confirmJoin();
}

/** The codes did not match: ask again from the start. */
export async function restartJoin(): Promise<void> {
  await (await import('./invites')).invites.restartJoin();
}

/** Declined: forget this code so another one can be entered. */
export async function forgetJoinCode(): Promise<void> {
  await (await import('./invites')).invites.forgetJoinCode();
}
