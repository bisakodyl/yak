import type * as Y from 'yjs';
import { useEffect, useState } from 'preact/hooks';
import type { EncryptionParams } from './crypto';
import { keyPrompt } from '../app/key-prompt';
import { deviceKey, readAccountEncryption } from './encryption-state';

/** The account's passphrase parameters (undefined: none set) and whether this device holds the derived key. */
export function usePassphraseState(account: Y.Doc, accountId: string): { params: EncryptionParams | undefined; hasKey: boolean; setHasKey(v: boolean): void } {
  const [params, setParams] = useState(() => readAccountEncryption(account));
  const [hasKey, setHasKey] = useState(false);
  // The passphrase sheet may just have saved the key on this device.
  const [sheetDone, setSheetDone] = useState(keyPrompt.version);
  useEffect(() => keyPrompt.subscribe(() => setSheetDone(keyPrompt.version)), []);
  useEffect(() => {
    const sync = (): void => setParams(readAccountEncryption(account));
    account.getMap('settings').observe(sync);
    return () => account.getMap('settings').unobserve(sync);
  }, [account]);
  useEffect(() => {
    let live = true;
    void deviceKey(accountId, account).then((k) => live && setHasKey(!!k));
    return () => {
      live = false;
    };
  }, [accountId, account, params, sheetDone]);
  return { params, hasKey, setHasKey };
}
