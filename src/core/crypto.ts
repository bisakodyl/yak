import { TEST_BUILD } from './test-build';
import { encodeText } from './bytes';

/** Shared by encrypted backups (S18) and the sealed account key (S-76b): the parameters check, the errors, and AES-GCM over bytes with a header. */

export const DEFAULT_ITERATIONS = 600_000;
/** Stored parameters come from the account document or a folder, so they are not trusted: too few is weak, too many freezes the tab. */
export const MIN_ITERATIONS = 100_000;
export const MAX_ITERATIONS = 10_000_000;
/** A test build also accepts the small counts the browser tests use. */
export function iterationsValid(n: number, testBuild = TEST_BUILD): boolean {
  return Number.isInteger(n) && n <= MAX_ITERATIONS && (n >= MIN_ITERATIONS || (testBuild && n >= 1));
}

/** What is not secret and is needed to derive the key again: kept in the account document and in the account folder. */
export interface EncryptionParams {
  salt: string;
  /** SHA-256 over the derived key and a fixed label: tells a wrong passphrase before any file is read. */
  check: string;
  iterations: number;
}

export class WrongPassphraseError extends Error {
  constructor(message = 'Wrong passphrase.') {
    super(message);
    this.name = 'WrongPassphraseError';
  }
}

export class InvalidParamsError extends Error {
  constructor() {
    super('The encryption settings are invalid (unexpected iteration count), so they were not used.');
    this.name = 'InvalidParamsError';
  }
}

export const MAGIC = encodeText('PDENC1');
const IV_BYTES = 12;

export async function encryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data as Uint8Array<ArrayBuffer>));
  const out = new Uint8Array(MAGIC.length + IV_BYTES + ct.length);
  out.set(MAGIC);
  out.set(iv, MAGIC.length);
  out.set(ct, MAGIC.length + IV_BYTES);
  return out;
}

export async function decryptBytes(key: CryptoKey, data: Uint8Array): Promise<Uint8Array> {
  const iv = data.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as Uint8Array<ArrayBuffer> }, key, data.subarray(MAGIC.length + IV_BYTES) as Uint8Array<ArrayBuffer>));
  } catch {
    throw new WrongPassphraseError('A file did not decrypt: wrong passphrase, or the file is damaged.');
  }
}

export const isEncrypted = (data: Uint8Array): boolean => data.length > MAGIC.length + IV_BYTES && MAGIC.every((b, i) => data[i] === b);
