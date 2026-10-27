// The passphrase rules, apart from the word list so the main chunk need not carry it (F-309).

/** Shortest passphrase accepted when the person types their own (S-76m, raised from 12 by F-309). */
export const MIN_PASSPHRASE = 20;
/** Below this a passphrase is accepted with a warning: "four or more random words is best" (F-309). */
export const GOOD_PASSPHRASE = 28;

/** Why a typed passphrase is not accepted (undefined when it is). */
export function passphraseProblem(passphrase: string): string | undefined {
  if (passphrase.length < MIN_PASSPHRASE) return `Use at least ${MIN_PASSPHRASE} characters. Four or more random words is best.`;
  if (new Set(passphrase).size < 5) return 'Use a passphrase with more variety.';
  return undefined;
}

/** A line shown under a passphrase field while typing: a problem blocks, a warning does not (F-309). Nothing for an empty field. */
export function passphraseHint(passphrase: string): { level: 'error' | 'warn' | 'ok'; text: string } | undefined {
  if (!passphrase) return undefined;
  const problem = passphraseProblem(passphrase);
  if (problem) return { level: 'error', text: problem };
  if (passphrase.length < GOOD_PASSPHRASE) return { level: 'warn', text: 'This works, but four or more random words is best.' };
  return { level: 'ok', text: 'Long enough.' };
}
