/**
 * The pairing secret: the only thing a person carries between two devices, once per pair.
 *
 * 128 random bits, written as 28 characters of base32 in groups of four (26 data characters
 * plus 2 check characters), short enough to read aloud, type, keep in a password manager or
 * put in a QR code. Both the signaling topic and the message key are derived from it, so the
 * topic name is as unguessable as the key and the signaling server never learns either.
 */
import { PAIRING_KEY_INFO, PAIRING_SALT, PAIRING_TOPIC_INFO, TOPIC_PREFIX } from '../core/protocol-ids';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DATA_CHARS = 26;
const CHECK_CHARS = 2;
const TOTAL_CHARS = DATA_CHARS + CHECK_CHARS;

/** Characters people mistype, mapped to the alphabet character they most likely meant. */
const LOOKALIKES: Record<string, string> = { '0': 'O', '1': 'I', '8': 'B' };

function encodeBase32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function decodeBase32(text: string): Uint8Array {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text) {
    const index = ALPHABET.indexOf(ch);
    if (index < 0) throw new Error('Invalid character in pairing secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

/** Two check characters (10 bits) over the data characters; catches a typo or a swapped pair. */
function checksum(data: string): string {
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += (i + 1) * (ALPHABET.indexOf(data[i] ?? '') + 1);
  const n = sum % 1024;
  return (ALPHABET[n >> 5] ?? '') + (ALPHABET[n & 31] ?? '');
}

function group(text: string): string {
  return text.match(/.{1,4}/g)?.join('-') ?? text;
}

/** Make a fresh secret and its display form, `ABCD-EFGH-...`. */
export function generateSecret(random: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  const data = encodeBase32(random(16)).slice(0, DATA_CHARS);
  return group(data + checksum(data));
}

/** Clean up what a person typed or pasted, then validate length, alphabet and check characters. */
export function normalizeSecret(text: string): string {
  const cleaned = text
    .toUpperCase()
    .replace(/[\s-]+/g, '')
    .replace(/[018]/g, (c) => LOOKALIKES[c] ?? c);
  if (cleaned.length !== TOTAL_CHARS) throw new Error(`A pairing secret has ${TOTAL_CHARS} characters`);
  if (![...cleaned].every((c) => ALPHABET.includes(c))) throw new Error('A pairing secret uses letters A-Z and digits 2-7');
  const data = cleaned.slice(0, DATA_CHARS);
  if (checksum(data) !== cleaned.slice(DATA_CHARS)) throw new Error('That pairing secret has a typo: the check characters do not match');
  return cleaned;
}

/** The 16 secret bytes behind a secret in any accepted spelling. */
export function secretBytes(text: string): Uint8Array {
  return decodeBase32(normalizeSecret(text).slice(0, DATA_CHARS)).slice(0, 16);
}

export interface DerivedKeys {
  /** Signaling topic: letters, digits and dashes only, so it is valid on ntfy. */
  topic: string;
  /** AES-GCM key for signaling messages. Not extractable. */
  key: CryptoKey;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** HKDF-SHA256 from the secret: one expansion for the topic name, one for the message key. A one-time invite uses its own infos (`invite.ts`). */
export async function deriveKeys(secret: string, info: { topic: string; key: string } = { topic: PAIRING_TOPIC_INFO, key: PAIRING_KEY_INFO }): Promise<DerivedKeys> {
  const material = await crypto.subtle.importKey('raw', secretBytes(secret) as BufferSource, 'HKDF', false, ['deriveBits', 'deriveKey']);
  const salt = new TextEncoder().encode(PAIRING_SALT);
  const topicBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info.topic) },
    material,
    128,
  );
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode(info.key) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  return { topic: `${TOPIC_PREFIX}${toHex(new Uint8Array(topicBits))}`, key };
}
