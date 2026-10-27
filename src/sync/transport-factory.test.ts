import { describe, expect, it, vi } from 'vitest';
import { NtfyTransport } from './signaling';
import { WebSocketTransport } from './signaling-ws';
import { createTransport, defaultSignalingUrl, isRelayUrl, NTFY_SIGNALING_URL } from './transport-factory';

describe('createTransport', () => {
  it('uses the WebSocket relay for ws:// and wss:// URLs', () => {
    expect(createTransport('wss://yak.example/signal')).toBeInstanceOf(WebSocketTransport);
    expect(createTransport(' ws://localhost:8787/signal ')).toBeInstanceOf(WebSocketTransport);
    expect(createTransport('WSS://yak.example/signal')).toBeInstanceOf(WebSocketTransport);
  });

  it('uses ntfy for http(s) URLs', () => {
    expect(createTransport('https://ntfy.sh')).toBeInstanceOf(NtfyTransport);
    expect(createTransport('http://localhost:8092')).toBeInstanceOf(NtfyTransport);
  });

  it("defaults to this site's relay on a page, and to ntfy where there is no page", () => {
    expect(defaultSignalingUrl()).toBe(NTFY_SIGNALING_URL);
    expect(createTransport('')).toBeInstanceOf(NtfyTransport);
    vi.stubGlobal('location', { protocol: 'https:', host: 'yak.example' });
    try {
      expect(defaultSignalingUrl()).toBe('wss://yak.example/signal');
      expect(createTransport('')).toBeInstanceOf(WebSocketTransport);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recognises relay URLs', () => {
    expect(isRelayUrl('wss://x/signal')).toBe(true);
    expect(isRelayUrl('https://ntfy.sh')).toBe(false);
  });
});
