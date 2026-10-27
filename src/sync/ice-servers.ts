import { STORAGE_PREFIX } from '../constants';

/** Tried in this order. STUN only tells a device its public address; no data passes through it. */
export const DEFAULT_STUN_URLS = ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'];

const KEY = `${STORAGE_PREFIX}-ice-servers`;

const isIceUrl = (url: string): boolean => /^(stun|stuns|turn|turns):\S+$/i.test(url);

/** One ICE server URL per line or comma-separated; anything that is not a stun/turn URL is dropped. */
export function parseIceUrls(text: string): string[] {
  return [...new Set(text.split(/[\s,]+/).filter(isIceUrl))];
}

/** The device's own list, or the defaults when none was saved. */
export function loadIceUrls(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const urls = parseIceUrls((JSON.parse(raw) as string[]).join('\n'));
      if (urls.length > 0) return urls;
    }
  } catch {
    // Storage unavailable or unreadable: use the defaults.
  }
  return DEFAULT_STUN_URLS;
}

/** Saves the list; an empty or default list clears the setting so later defaults apply. */
export function saveIceUrls(urls: string[]): void {
  const clean = parseIceUrls(urls.join('\n'));
  const isDefault = clean.length === 0 || clean.join() === DEFAULT_STUN_URLS.join();
  try {
    if (isDefault) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Storage unavailable: the list lasts until the page closes.
  }
}

export const toIceServers = (urls: string[]): RTCIceServer[] => urls.map((u) => ({ urls: u }));
