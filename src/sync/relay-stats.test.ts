import { describe, expect, it } from 'vitest';
import { fetchRelayStats, relayStatsDetails, relayStatsText, statsUrl } from './relay-stats';

const topic = 'yk-' + 'a'.repeat(32);
const json = (body: unknown, status = 200): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('relay stats', () => {
  it('builds the URL for a relay and none for ntfy', () => {
    expect(statsUrl('wss://yak.example/signal', topic)).toBe(`https://yak.example/signal/${topic}/stats`);
    expect(statsUrl('https://ntfy.sh', topic)).toBeUndefined();
  });

  it('reads our relay\'s answer and refuses anything else', async () => {
    const body = { service: 'yak-relay', devices: 3, links: 1, hour: { messages: 5, bytes: 100 }, day: { messages: 420, bytes: 36000 }, lastActivity: 1760000000 };
    const stats = await fetchRelayStats('wss://x.example/signal', topic, json(body));
    expect(stats?.devices).toBe(3);
    expect(relayStatsText(stats!)).toBe('Relay: 3 devices connected · 420 messages today (35 KB)');
    expect(relayStatsDetails(stats!)).toHaveLength(4);
    expect(await fetchRelayStats('wss://x.example/signal', topic, json({ devices: 1 }))).toBeUndefined();
    expect(await fetchRelayStats('wss://x.example/signal', topic, json(body, 503))).toBeUndefined();
    expect(await fetchRelayStats('wss://x.example/signal', topic, (async () => { throw new Error('x'); }) as typeof fetch)).toBeUndefined();
  });
});
