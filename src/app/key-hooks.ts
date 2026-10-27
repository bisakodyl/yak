import type * as Y from 'yjs';
import { useEffect, useState } from 'preact/hooks';
import { chosenKeyState, keysMap } from '../core/account-keys';
import { localAccountKey } from '../sync/key-store';
import { keyTrust, type KeyTrust } from './account-keys-runtime';

/** The account key (S-76b) not yet sealed, read from the account document. */
export function useUnsealedKey(account: Y.Doc): { fingerprint: string; by: string } | undefined {
  const [state, setState] = useState(() => chosenKeyState(account));
  useEffect(() => {
    const read = (): void => setState(chosenKeyState(account));
    read();
    keysMap(account).observe(read);
    return () => keysMap(account).unobserve(read);
  }, [account]);
  return state && !state.sealed ? state : undefined;
}

/** Whether this device still holds the private half of the account key with this fingerprint (until the passphrase seals it). */
export function useHoldsKey(fingerprint: string | undefined): boolean | undefined {
  const [holds, setHolds] = useState<boolean | undefined>();
  useEffect(() => {
    let live = true;
    setHolds(undefined);
    if (fingerprint) void localAccountKey(fingerprint).then((k) => live && setHolds(!!k));
    return () => {
      live = false;
    };
  }, [fingerprint]);
  return holds;
}

/** Re-render when what this device knows about certified keys changes (`keyTrust`); returns it. */
export function useKeyTrust(): KeyTrust {
  const [, setTick] = useState(0);
  useEffect(() => keyTrust.subscribe(() => setTick((t) => t + 1)), []);
  return keyTrust;
}
