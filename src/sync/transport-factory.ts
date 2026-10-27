import { NtfyTransport, type SignalingTransport } from './signaling';
import { WebSocketTransport, siteRelayUrl } from './signaling-ws';

/** Public ntfy: the alternative signaling server, and the app's default until October 2026. */
export const NTFY_SIGNALING_URL = 'https://ntfy.sh';

/**
 * The default signaling server: this site's own relay (`wss://<this host>/signal`). Outside a page,
 * as in unit tests, there is no site, so ntfy.
 */
export function defaultSignalingUrl(): string {
  return globalThis.location?.host ? siteRelayUrl() : NTFY_SIGNALING_URL;
}

export const isRelayUrl = (url: string): boolean => /^wss?:\/\//i.test(url.trim());

/** Pick a signaling backend from the setting: `ws://` or `wss://` is a relay, anything else is ntfy; empty is the default. */
export function createTransport(url: string): SignalingTransport {
  const trimmed = url.trim() || defaultSignalingUrl();
  if (isRelayUrl(trimmed)) return new WebSocketTransport({ baseUrl: trimmed });
  return new NtfyTransport({ baseUrl: trimmed });
}
