import type * as Y from 'yjs';
import { passphraseProblem } from '../core/passphrase-rules';
import { testMode } from '../core/test-build';
import { keyFor, newEncryption, type EncryptionParams } from './crypto';
import { saveDeviceKey, writeAccountEncryption } from './encryption-state';

/**
 * Set the account's passphrase on this device: check the rules, write the parameters to the account
 * document and keep the derived key here. The caller then announces it (`passphrase:ready`), which seals the account key.
 */
export async function setNewPassphrase(account: Y.Doc, accountId: string, pass: string, again: string): Promise<void> {
  const problem = passphraseProblem(pass);
  if (problem) throw new Error(problem);
  if (pass !== again) throw new Error('The two passphrases differ.');
  // Browser tests (`?test`) use few iterations so a loaded CI machine stays fast.
  const made = await newEncryption(pass, testMode() ? 1000 : undefined);
  writeAccountEncryption(account, made.params);
  await saveDeviceKey(accountId, made.params, made.key);
}

/** Check a typed passphrase against the account's parameters (refused when wrong) and keep its key on this device. */
export async function useExistingPassphrase(accountId: string, params: EncryptionParams, pass: string): Promise<void> {
  await saveDeviceKey(accountId, params, await keyFor(pass, params));
}
