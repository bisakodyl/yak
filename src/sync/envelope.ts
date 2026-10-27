/**
 * Authenticated encryption for signaling messages. The signaling server, and anything that can
 * read its topic, sees only opaque text. A message that fails authentication, is too old or has
 * been seen before is dropped, so a leaked topic name alone lets nobody forge or replay a handshake.
 */
import { ENVELOPE_PREFIX } from '../core/protocol-ids';

export type SignalType = 'hello' | 'offer' | 'answer';

export interface SignalPayload {
  type: SignalType;
  /** Sending device. */
  from: string;
  /** Receiving device, for messages meant for one peer (offers and answers); absent means everyone. */
  to?: string;
  /** Pairing attempt this message belongs to; an answer must carry the offer's value. */
  sid: string;
  /** Milliseconds since the epoch on the sender's clock; informational, freshness uses server time. */
  ts: number;
  /** For offer and answer: the packed session description (sync code). */
  code?: string;
  /** Offer and answer from a certified device: its signature (`handshake.ts`). Older builds ignore it. */
  sig?: string;
  /** Hello from a certified device: the peers whose certificates it verified (`peerTag`). */
  vp?: string[];
}

const VERSION = 'v1';
const NONCE_BYTES = 12;

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function aad(topic: string): BufferSource {
  return new TextEncoder().encode(`${ENVELOPE_PREFIX}${VERSION}:${topic}`);
}

/** Encrypt a payload; returns `nonce || ciphertext` as base64url. */
export async function seal(key: CryptoKey, topic: string, payload: SignalPayload): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad(topic) }, key, plaintext as BufferSource),
  );
  const out = new Uint8Array(nonce.length + ciphertext.length);
  out.set(nonce, 0);
  out.set(ciphertext, nonce.length);
  return toBase64Url(out);
}

export interface Opened {
  payload: SignalPayload;
  /** Unique per message; used to reject replays. */
  nonce: string;
}

/** Decrypt and validate. Throws on a wrong key, tampering, a wrong topic or a malformed payload. */
export async function open(key: CryptoKey, topic: string, text: string): Promise<Opened> {
  const bytes = fromBase64Url(text.trim());
  if (bytes.length <= NONCE_BYTES) throw new Error('Message too short');
  const nonce = bytes.slice(0, NONCE_BYTES);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad(topic) },
    key,
    bytes.slice(NONCE_BYTES) as BufferSource,
  );
  const parsed = JSON.parse(new TextDecoder().decode(plaintext)) as Partial<SignalPayload>;
  if (
    (parsed.type !== 'hello' && parsed.type !== 'offer' && parsed.type !== 'answer') ||
    typeof parsed.from !== 'string' ||
    typeof parsed.sid !== 'string' ||
    typeof parsed.ts !== 'number' ||
    (parsed.code !== undefined && typeof parsed.code !== 'string') ||
    (parsed.to !== undefined && typeof parsed.to !== 'string') ||
    (parsed.sig !== undefined && typeof parsed.sig !== 'string') ||
    (parsed.vp !== undefined && (!Array.isArray(parsed.vp) || parsed.vp.length > 64 || !parsed.vp.every((t) => typeof t === 'string')))
  ) {
    throw new Error('Malformed message');
  }
  return { payload: parsed as SignalPayload, nonce: toBase64Url(nonce) };
}

/**
 * Rejects messages that are too old or whose nonce was seen before. The caller supplies the age,
 * measured on the signaling server's clock, so a device with a wrong clock still judges freshness.
 */
export class ReplayGuard {
  private readonly seen = new Set<string>();

  constructor(
    private readonly maxAgeMs = 5 * 60_000,
    private readonly capacity = 1000,
  ) {}

  accept(nonce: string, ageMs: number): boolean {
    if (ageMs > this.maxAgeMs || ageMs < -this.maxAgeMs) return false;
    if (this.seen.has(nonce)) return false;
    this.seen.add(nonce);
    if (this.seen.size > this.capacity) {
      const oldest = this.seen.values().next().value;
      if (oldest !== undefined) this.seen.delete(oldest);
    }
    return true;
  }
}
