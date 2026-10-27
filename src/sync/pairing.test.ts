import { describe, expect, it } from 'vitest';
import { open, ReplayGuard, seal, type SignalPayload } from './envelope';
import { deriveKeys, generateSecret, normalizeSecret, secretBytes } from './pairing-secret';

const payload: SignalPayload = { type: 'offer', from: 'dev-a', sid: 's1', ts: 1_000_000, code: 'yk1.abc' };

describe('pairing secret', () => {
  it('is 28 characters in groups of four', () => {
    const secret = generateSecret();
    expect(secret).toMatch(/^([A-Z2-7]{4}-){6}[A-Z2-7]{4}$/);
  });

  it('is random', () => {
    expect(generateSecret()).not.toBe(generateSecret());
  });

  it('is accepted in lowercase, with spaces, or without dashes', () => {
    const secret = generateSecret();
    const loose = secret.toLowerCase().replace(/-/g, ' ');
    expect(normalizeSecret(loose)).toBe(secret.replace(/-/g, ''));
    expect(secretBytes(secret)).toEqual(secretBytes(loose));
  });

  it('maps look-alike digits to the letters they stand for', () => {
    const fixed = generateSecret(() => new Uint8Array(16).fill(0));
    const plain = normalizeSecret(fixed);
    const typed = plain.replace(/O/g, '0').replace(/I/g, '1').replace(/B/g, '8');
    expect(normalizeSecret(typed)).toBe(plain);
  });

  it('rejects a typo through the check characters', () => {
    const secret = generateSecret(() => new Uint8Array(16).map((_, i) => i * 7));
    const plain = secret.replace(/-/g, '');
    const swapped = (plain[0] === 'A' ? 'B' : 'A') + plain.slice(1);
    expect(() => normalizeSecret(swapped)).toThrow(/typo/);
  });

  it('rejects the wrong length and characters', () => {
    expect(() => normalizeSecret('ABCD')).toThrow(/28 characters/);
    expect(() => normalizeSecret('!'.repeat(28))).toThrow(/letters/);
  });

  it('yields 16 bytes', () => {
    expect(secretBytes(generateSecret())).toHaveLength(16);
  });
});

describe('key derivation', () => {
  it('derives the same topic from the same secret and a different one otherwise', async () => {
    const secret = generateSecret();
    const a = await deriveKeys(secret);
    const b = await deriveKeys(secret.toLowerCase());
    const c = await deriveKeys(generateSecret());
    expect(a.topic).toBe(b.topic);
    expect(a.topic).not.toBe(c.topic);
    expect(a.topic).toMatch(/^yk-[0-9a-f]{32}$/);
  });
});

describe('signaling envelope', () => {
  it('round-trips a payload', async () => {
    const { key, topic } = await deriveKeys(generateSecret());
    const text = await seal(key, topic, payload);
    expect(text).toMatch(/^[A-Za-z0-9_-]+$/);
    expect((await open(key, topic, text)).payload).toEqual(payload);
  });

  it('does not reveal the payload in the sealed text', async () => {
    const { key, topic } = await deriveKeys(generateSecret());
    const text = await seal(key, topic, payload);
    expect(atob(text.replace(/-/g, '+').replace(/_/g, '/'))).not.toContain('dev-a');
  });

  it('fails with the wrong key', async () => {
    const one = await deriveKeys(generateSecret());
    const two = await deriveKeys(generateSecret());
    const text = await seal(one.key, one.topic, payload);
    await expect(open(two.key, one.topic, text)).rejects.toThrow();
  });

  it('fails when the topic does not match', async () => {
    const { key, topic } = await deriveKeys(generateSecret());
    const text = await seal(key, topic, payload);
    await expect(open(key, 'yk-other', text)).rejects.toThrow();
  });

  it('fails when the text was altered', async () => {
    const { key, topic } = await deriveKeys(generateSecret());
    const text = await seal(key, topic, payload);
    const flipped = text.slice(0, 20) + (text[20] === 'A' ? 'B' : 'A') + text.slice(21);
    await expect(open(key, topic, flipped)).rejects.toThrow();
  });

  it('produces different text for the same payload each time', async () => {
    const { key, topic } = await deriveKeys(generateSecret());
    expect(await seal(key, topic, payload)).not.toBe(await seal(key, topic, payload));
  });
});

describe('ReplayGuard', () => {
  it('accepts a fresh message once', () => {
    const guard = new ReplayGuard(60_000);
    expect(guard.accept('nonce-1', 1_000)).toBe(true);
    expect(guard.accept('nonce-1', 1_000)).toBe(false);
  });

  it('rejects messages older than the window, judged by the age it is given', () => {
    const guard = new ReplayGuard(60_000);
    expect(guard.accept('old', 61_000)).toBe(false);
    expect(guard.accept('future', -61_000)).toBe(false);
    expect(guard.accept('recent', 30_000)).toBe(true);
  });
});
