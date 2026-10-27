import { MIN_PASSPHRASE } from '../core/passphrase-rules';

const KEY = 'app-short-passphrase';

/**
 * Remembers on this device that the passphrase just typed (right) is shorter than new ones may be,
 * so Security can suggest a longer one. The passphrase itself is never stored; short ones keep working (F-309).
 */
export function notePassphraseLength(passphrase: string): void {
  try {
    if (passphrase.length < MIN_PASSPHRASE) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function passphraseIsShort(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}
