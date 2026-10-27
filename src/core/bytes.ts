import { fromBase64, toBase64 } from 'lib0/buffer';

/** Byte and text helpers shared by the keys, the passphrase sealing and the backups. */
export const encodeText = (s: string): Uint8Array => new TextEncoder().encode(s);
export const decodeText = (b: Uint8Array): string => new TextDecoder('utf-8', { fatal: true }).decode(b);
export const base64 = (b: Uint8Array): string => toBase64(b);
export const unbase64 = (s: string): Uint8Array => fromBase64(s);
export const base64url = (b: Uint8Array): string => base64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const unbase64url = (s: string): Uint8Array => unbase64(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4));
