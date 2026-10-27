import { base64url, unbase64url } from '../core/bytes';
import { formatFingerprint } from '../core/keys';
import { ReplayGuard } from './envelope';
import type { DerivedKeys } from './pairing-secret';
import type { InboxMessage } from './signaling';

/**
 * What a one-time invite (`invite.ts`) and a share link (`share-link.ts`) have in common: JSON messages
 * sealed with a key from a code on a mailbox topic, freshness by server time, and the code both screens compare.
 */

/** How long an invite or a share link stays open. */
export const MAILBOX_TTL_MS = 15 * 60_000;

/** `nonce || ciphertext` as base64url; the associated data binds the message to its kind of mailbox and topic. */
export async function sealMessage(keys: DerivedKeys, envelope: string, m: object): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(envelope + keys.topic) }, keys.key, new TextEncoder().encode(JSON.stringify(m))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  return base64url(out);
}

/** Open a message; undefined for anything that does not decrypt (wrong key, garbage, too big). The caller checks the shape. */
export async function openMessage(keys: DerivedKeys, envelope: string, text: string, maxBytes: number): Promise<{ m: Record<string, unknown>; nonce: string } | undefined> {
  try {
    const bytes = unbase64url(text.trim());
    if (bytes.length < 12 + 16 || bytes.length > maxBytes) return undefined;
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.subarray(0, 12) as Uint8Array<ArrayBuffer>, additionalData: new TextEncoder().encode(envelope + keys.topic) }, keys.key, bytes.subarray(12) as Uint8Array<ArrayBuffer>);
    const m = JSON.parse(new TextDecoder().decode(plain)) as unknown;
    if (!m || typeof m !== 'object' || Array.isArray(m)) return undefined;
    return { m: m as Record<string, unknown>, nonce: base64url(bytes.subarray(0, 12)) };
  } catch {
    return undefined;
  }
}

/** Messages are fresh (server time) and never seen before. */
export function freshness(): (msg: InboxMessage, nonce: string) => boolean {
  const guard = new ReplayGuard(MAILBOX_TTL_MS);
  return (msg, nonce) => guard.accept(nonce, Date.now() - msg.time * 1000);
}

/** 64 bits over a label and the fields both screens must agree on, as four groups of four. */
export async function compareDigest(label: string, fields: readonly string[]): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${label}\u0000${JSON.stringify(fields)}`)));
  return formatFingerprint(Array.from(d.slice(0, 8), (b) => b.toString(16).padStart(2, '0')).join(''), 4);
}

export const isStr = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length < 200;
