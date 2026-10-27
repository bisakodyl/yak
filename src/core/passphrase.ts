import { PASSPHRASE_WORDS } from './passphrase-words';
import { GOOD_PASSPHRASE } from './passphrase-rules';

export { GOOD_PASSPHRASE, MIN_PASSPHRASE, passphraseHint, passphraseProblem } from './passphrase-rules';

/** A random index below `n` without modulo bias: values from the biased tail are discarded. */
function randomBelow(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if ((buf[0] as number) < limit) return (buf[0] as number) % n;
  }
}

/** Five random words joined by hyphens from the 7776-word EFF list: about 64.6 bits, slowed down by the key derivation (S-76q). A draw shorter than the warning length is drawn again. */
export function generatePassphrase(words = 5): string {
  for (;;) {
    const phrase = Array.from({ length: words }, () => PASSPHRASE_WORDS[randomBelow(PASSPHRASE_WORDS.length)]).join('-');
    if (phrase.length >= GOOD_PASSPHRASE) return phrase;
  }
}
