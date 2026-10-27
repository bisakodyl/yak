import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_STUN_URLS, loadIceUrls, parseIceUrls, saveIceUrls, toIceServers } from './ice-servers';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
});

describe('ice servers', () => {
  it('defaults to Cloudflare then Google STUN', () => {
    expect(loadIceUrls()).toEqual(['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
  });

  it('parses lines and commas, dropping other text and duplicates', () => {
    expect(parseIceUrls('stun:a:1, http://x\nturn:b:2 stun:a:1')).toEqual(['stun:a:1', 'turn:b:2']);
  });

  it('keeps a custom list and returns to defaults when cleared', () => {
    saveIceUrls(['stun:mine.example:3478']);
    expect(loadIceUrls()).toEqual(['stun:mine.example:3478']);
    saveIceUrls([]);
    expect(loadIceUrls()).toEqual(DEFAULT_STUN_URLS);
  });

  it('maps to RTCIceServer entries', () => {
    expect(toIceServers(['stun:a:1'])).toEqual([{ urls: 'stun:a:1' }]);
  });
});
