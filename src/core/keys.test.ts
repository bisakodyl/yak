import { describe, expect, it } from 'vitest';
import { accountIdOfKey, fingerprint, formatFingerprint, generateAccountKey, generateDeviceKeys, isPublicKeyJwk, sign, unwrap, verify, wrapFor } from './keys';

describe('keys', () => {
  it('fingerprints a public key the same way every time; the account id is its first 24 hex characters', async () => {
    const { publicKey } = await generateAccountKey();
    const fp = await fingerprint(publicKey);
    expect(fp).toMatch(/^[a-f0-9]{32}$/);
    expect(await fingerprint({ ...publicKey })).toBe(fp);
    expect(await accountIdOfKey(publicKey)).toBe(fp.slice(0, 24));
    expect(formatFingerprint(fp)).toBe(fp.match(/.{4}/g)!.slice(0, 4).join(' '));
    expect(await fingerprint((await generateAccountKey()).publicKey)).not.toBe(fp);
  });

  it('signs and verifies, and refuses another key or another message', async () => {
    const a = await generateAccountKey();
    const b = await generateAccountKey();
    const data = new TextEncoder().encode('hello');
    const sig = await sign(a.privateKey, data);
    expect(await verify(a.publicKey, data, sig)).toBe(true);
    expect(await verify(b.publicKey, data, sig)).toBe(false);
    expect(await verify(a.publicKey, new TextEncoder().encode('hellO'), sig)).toBe(false);
  });

  it('keeps device private halves non-extractable', async () => {
    const d = await generateDeviceKeys();
    expect(d.sign.privateKey.extractable).toBe(false);
    expect(d.agree.privateKey.extractable).toBe(false);
    await expect(crypto.subtle.exportKey('jwk', d.agree.privateKey)).rejects.toBeTruthy();
    expect(isPublicKeyJwk(d.publicKeys.sign)).toBe(true);
    expect(Object.keys(d.publicKeys.sign).sort()).toEqual(['crv', 'kty', 'x', 'y']);
  });

  it('wraps a key to a device public key; only that device unwraps it', async () => {
    const d = await generateDeviceKeys();
    const other = await generateDeviceKeys();
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const wrapped = await wrapFor(d.publicKeys.agree, secret);
    expect(Array.from(await unwrap(d.agree.privateKey, wrapped))).toEqual(Array.from(secret));
    await expect(unwrap(other.agree.privateKey, wrapped)).rejects.toBeTruthy();
  });

  it('rejects malformed public keys from a synced document', () => {
    expect(isPublicKeyJwk(null)).toBe(false);
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-384', x: 'a', y: 'b' })).toBe(false);
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-256', x: 'a'.repeat(100), y: 'b' })).toBe(false);
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-256', x: '<script>', y: 'b' })).toBe(false);
    // Exactly 32 bytes (43 base64url characters) each.
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(64), y: 'A'.repeat(64) })).toBe(false);
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(42), y: 'A'.repeat(43) })).toBe(false);
    expect(isPublicKeyJwk({ kty: 'EC', crv: 'P-256', x: 'A'.repeat(43), y: 'A'.repeat(43) })).toBe(true);
  });
});

describe('remembered checks', () => {
  it('verifies a signed record once, then answers from memory', async () => {
    const { vi } = await import('vitest');
    const { verifyText } = await import('./keys');
    const a = await generateAccountKey();
    const text = 'yak/v1/test\u0000record';
    const sig = (await import('./bytes')).base64(await sign(a.privateKey, new TextEncoder().encode(text)));
    const spy = vi.spyOn(crypto.subtle, 'verify');
    expect(await verifyText(a.publicKey, text, sig)).toBe(true);
    expect(await verifyText(a.publicKey, text, sig)).toBe(true);
    expect(await verifyText(a.publicKey, `${text}!`, sig)).toBe(false);
    expect(spy).toHaveBeenCalledTimes(2);
    spy.mockRestore();
  });
});
