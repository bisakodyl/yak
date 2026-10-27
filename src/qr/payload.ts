import { APP_NAME } from '../constants';
import { FROM_EARLIER_VERSION, LEGACY, QR_PREFIX } from '../core/protocol-ids';
import { normalizeSecret } from '../sync/pairing-secret';
import { defaultSignalingUrl } from '../sync/transport-factory';

/**
 * What the pairing QR code carries: `yak:pair?v=1&s=<secret without dashes>[&sig=<url>]`.
 * The `sig` parameter is present only when the signaling server is not the default one.
 */
const PREFIX = QR_PREFIX;

export interface PairingPayload {
  /** Normalized secret, 28 characters without dashes. */
  secret: string;
  /** Signaling server named by the QR code; undefined means "the default". */
  signalingUrl?: string;
}

export function encodePairingPayload(secret: string, signalingUrl?: string): string {
  const params = new URLSearchParams({ v: '1', s: normalizeSecret(secret) });
  const sig = signalingUrl?.trim();
  if (sig && sig.replace(/\/+$/, '') !== defaultSignalingUrl()) params.set('sig', sig);
  return PREFIX + params.toString();
}

/** Parse and validate scanned text. Throws a message fit for the user when it is not a ${APP_NAME} pairing code. */
export function parsePairingPayload(text: string): PairingPayload {
  const trimmed = text.trim();
  if (trimmed.startsWith(LEGACY.qrPrefix)) throw new Error(`That QR code is ${FROM_EARLIER_VERSION}. Pair again with a new code.`);
  if (!trimmed.startsWith(PREFIX)) throw new Error(`That QR code is not a ${APP_NAME} pairing code`);
  const params = new URLSearchParams(trimmed.slice(PREFIX.length));
  if (params.get('v') !== '1') throw new Error(`That pairing code is from a different version of ${APP_NAME}`);
  const secret = normalizeSecret(params.get('s') ?? '');
  const sig = params.get('sig');
  if (sig === null) return { secret };
  let url: URL;
  try {
    url = new URL(sig);
  } catch {
    throw new Error('The connection server in that one-time code is not a valid URL');
  }
  if (!['https:', 'http:', 'wss:', 'ws:'].includes(url.protocol)) {
    throw new Error('The connection server in that one-time code must be an http(s) or ws(s) URL');
  }
  return { secret, signalingUrl: sig };
}
