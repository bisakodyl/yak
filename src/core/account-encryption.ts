import type * as Y from 'yjs';
import type { EncryptionParams } from './crypto';

/** The account's passphrase parameters (salt, check value): in the account document, so every device sees them. */
export function readAccountEncryption(account: Y.Doc): EncryptionParams | undefined {
  const v = account.getMap<unknown>('settings').get('backup_encryption') as Partial<EncryptionParams> | undefined;
  return v && typeof v.salt === 'string' && typeof v.check === 'string' && typeof v.iterations === 'number' ? (v as EncryptionParams) : undefined;
}

export function writeAccountEncryption(account: Y.Doc, params: EncryptionParams): void {
  account.getMap<unknown>('settings').set('backup_encryption', { salt: params.salt, check: params.check, iterations: params.iterations });
}
