import { describe, expect, it } from 'vitest';
import { GOOD_PASSPHRASE, MIN_PASSPHRASE, generatePassphrase, passphraseHint, passphraseProblem } from './passphrase';
import { PASSPHRASE_WORDS } from './passphrase-words';

describe('passphrase', () => {
  it('is the 7776-word EFF list, all distinct', () => {
    expect(PASSPHRASE_WORDS).toHaveLength(7776);
    expect(new Set(PASSPHRASE_WORDS).size).toBe(7776);
    for (const w of PASSPHRASE_WORDS) expect(w).toMatch(/^[a-z-]{3,9}$/);
  });
  it('generates five words that pass its own rule, and differ between calls', () => {
    const p = generatePassphrase();
    expect(p).toMatch(/^[a-z-]+$/);
    expect(p).not.toContain(' ');
    expect(p.split('-').length).toBeGreaterThanOrEqual(5);
    expect(passphraseProblem(p)).toBeUndefined();
    expect(generatePassphrase()).not.toBe(p);
  });
  it('asks for a longer or more varied passphrase', () => {
    expect(passphraseProblem('short one')).toMatch(/at least 20/);
    expect(passphraseProblem('aaaaaaaaaaaaaaaaaaaaaa')).toMatch(/variety/);
    expect(passphraseProblem('e2e passphrase')).toMatch(/at least 20/);
  });
  it('refuses under 20 characters and accepts 20', () => {
    expect(MIN_PASSPHRASE).toBe(20);
    expect(passphraseProblem('a'.repeat(19) + 'bcdef')).toBeUndefined();
    expect(passphraseProblem('abcdefghijklmnopqrs')).toMatch(/at least 20/);
    expect(passphraseProblem('abcdefghijklmnopqrst')).toBeUndefined();
  });
  it('always generates a phrase at the "good" length', () => {
    for (let i = 0; i < 200; i++) expect(generatePassphrase().length).toBeGreaterThanOrEqual(GOOD_PASSPHRASE);
  });
  it('hints while typing: nothing, error under 20, warning under 28, ok from 28', () => {
    expect(passphraseHint('')).toBeUndefined();
    expect(passphraseHint('too short')?.level).toBe('error');
    expect(passphraseHint('abcdefghijklmnopqrst')).toEqual({ level: 'warn', text: 'This works, but four or more random words is best.' });
    expect(passphraseHint('correct horse battery staple')?.level).toBe('ok');
    expect(passphraseHint('abcdefghijklmnopqrstuvwxyzab')?.level).toBe('ok');
    expect(passphraseHint('abcdefghijklmnopqrstuvwxyza')?.level).toBe('warn');
  });
});
