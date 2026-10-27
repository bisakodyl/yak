import { describe, expect, it } from 'vitest';
import { adminStatsUrl, fetchNetworkStats, summarize } from './network-stats';

const reply = (status: number, body: unknown): typeof fetch => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;

describe('network stats', () => {
  it('builds the admin URL for a relay only', () => {
    expect(adminStatsUrl('wss://yak.example/signal', 6)).toBe('https://yak.example/signal/admin/stats?hours=6');
    expect(adminStatsUrl('https://ntfy.sh', 6)).toBeUndefined();
  });

  it('sends the key as a bearer token and reads rows', async () => {
    let auth = '';
    const impl = (async (_u: string, init: RequestInit) => {
      auth = (init.headers as Record<string, string>).Authorization ?? '';
      return new Response(JSON.stringify({ service: 'yak-relay', rows: [{ hour: 'h1', kind: 'signal', rooms: 2, messages: 10, bytes: 100 }] }));
    }) as unknown as typeof fetch;
    const result = await fetchNetworkStats('wss://x.example/signal', 'secret', 24, impl);
    expect(auth).toBe('Bearer secret');
    expect(result.ok && result.rows[0]?.rooms).toBe(2);
  });

  it('tells a wrong key, a relay without stats and a failure apart', async () => {
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(401, {}))).toEqual({ ok: false, reason: 'key' });
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(404, {}))).toEqual({ ok: false, reason: 'off' });
    expect(await fetchNetworkStats('wss://x/signal', 'k', 24, reply(502, { error: 'x' }))).toEqual({ ok: false, reason: 'failed' });
  });

  it('summarizes peak rooms, totals and the share carried by links', () => {
    const s = summarize([
      { hour: 'h1', kind: 'signal', rooms: 2, messages: 10, bytes: 100 },
      { hour: 'h1', kind: 'link', rooms: 1, messages: 5, bytes: 300 },
      { hour: 'h2', kind: 'signal', rooms: 3, messages: 1, bytes: 100 },
    ]);
    expect(s).toEqual({ peakRooms: 3, messages: 16, bytes: 500, linkShare: 0.6 });
  });
});
