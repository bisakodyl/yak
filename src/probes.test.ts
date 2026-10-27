import { describe, expect, it } from 'vitest';
import { startMockRelay } from '../scripts/mock-relay.mjs';
import { explainLoopback, probeRelay, type LoopbackResult } from './probes';

const base: LoopbackResult = {
  outcome: 'open-timeout',
  messageDelivered: false,
  candidates: {},
  firstCandidateMs: null,
  offerSdpBytes: 0,
  states: {},
  candidateErrors: [],
  timeline: [],
};

describe('explainLoopback', () => {
  it('points at policy or an agent when no candidates were gathered', () => {
    expect(explainLoopback(base)).toMatch(/No ICE candidates .* policy/);
  });

  it('points at name resolution or a firewall when candidates exist but nothing connected', () => {
    const text = explainLoopback({ ...base, candidates: { 'host-mdns': 1 } });
    expect(text).toMatch(/never opened/);
    expect(text).toMatch(/mDNS/);
  });

  it('reports success plainly', () => {
    expect(explainLoopback({ ...base, outcome: 'ok', messageDelivered: true })).toBe('In-page data channel works');
  });

  it('reports an unexpected error with its message', () => {
    expect(explainLoopback({ ...base, outcome: 'error', error: 'boom' })).toBe('WebRTC error: boom');
  });
});

describe('probeRelay', () => {
  it('reports success against a working relay', async () => {
    const relay = await startMockRelay();
    try {
      const result = await probeRelay({ baseUrl: relay.url, timeoutMs: 2000 });
      expect(result.status).toBe('ok');
      expect(result.summary).toMatch(/delivered in \d+ ms/);
      expect(relay.state.messages).toBe(1);
      expect(relay.state.pings).toBe(1);
    } finally {
      await relay.close();
    }
  });

  it('reports failure, with advice, when the relay cannot be reached', async () => {
    const relay = await startMockRelay();
    const url = relay.url;
    await relay.close();
    const result = await probeRelay({ baseUrl: url, timeoutMs: 1000 });
    expect(result.status).toBe('fail');
    expect(result.summary).toMatch(/WebSockets may be blocked/);
  });

  it('reports failure when the relay never answers the ping', async () => {
    const relay = await startMockRelay();
    relay.state.silent = true;
    try {
      const result = await probeRelay({ baseUrl: relay.url, timeoutMs: 300 });
      expect(result.status).toBe('fail');
      expect(result.summary).toMatch(/pong timed out/);
    } finally {
      await relay.close();
    }
  });
});
