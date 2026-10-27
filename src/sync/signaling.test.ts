import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startMockNtfy, type MockNtfy } from '../../scripts/mock-ntfy.mjs';
import { NtfyTransport, type InboxMessage } from './signaling';

let mock: MockNtfy;
const stops: (() => void)[] = [];

beforeEach(async () => {
  mock = await startMockNtfy();
});

afterEach(async () => {
  for (const stop of stops.splice(0)) stop();
  await mock.close();
});

async function waitFor(condition: () => boolean, timeoutMs = 3000, label = 'condition'): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

function watch(transport: NtfyTransport, topic: string, since?: string): InboxMessage[] {
  const received: InboxMessage[] = [];
  stops.push(transport.subscribe(topic, { onMessage: (m) => received.push(m) }, since ? { since } : {}));
  return received;
}

describe('NtfyTransport', () => {
  it('delivers a live message to a watcher', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url });
    const received = watch(t, 'topic-a');
    await waitFor(() => mock.openStreams() === 1, 2000, 'stream open');
    await t.publish('topic-a', 'hello');
    await waitFor(() => received.length === 1, 2000, 'message');
    expect(received[0]?.message).toBe('hello');
  });

  it('replays cached messages from the `since` window on connect', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url });
    await t.publish('topic-b', 'earlier');
    const received = watch(t, 'topic-b', '5m');
    await waitFor(() => received.length === 1, 2000, 'replayed message');
    expect(received[0]?.message).toBe('earlier');
  });

  it('keeps topics separate', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url });
    const received = watch(t, 'topic-c');
    await t.publish('topic-other', 'not for you');
    await t.publish('topic-c', 'for you');
    await waitFor(() => received.length === 1, 2000, 'message');
    expect(received.map((m) => m.message)).toEqual(['for you']);
  });

  it('reconnects after the stream is dropped and resumes without duplicates or gaps', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url, retryMs: 20, maxRetryMs: 50 });
    const statuses: string[] = [];
    const received: InboxMessage[] = [];
    stops.push(
      t.subscribe('topic-d', { onMessage: (m) => received.push(m), onStatus: (s) => statuses.push(s) }, { since: '5m' }),
    );
    await waitFor(() => mock.openStreams() === 1, 2000, 'stream open');
    await t.publish('topic-d', 'one');
    await waitFor(() => received.length === 1, 2000, 'first');

    mock.dropStreams();
    // A message arrives while the watcher is disconnected.
    await t.publish('topic-d', 'two');
    await waitFor(() => received.length === 2, 3000, 'message after reconnect');
    await t.publish('topic-d', 'three');
    await waitFor(() => received.length === 3, 2000, 'third');

    expect(received.map((m) => m.message)).toEqual(['one', 'two', 'three']);
    expect(statuses).toContain('disconnected');
    expect(statuses.filter((s) => s === 'connected').length).toBeGreaterThanOrEqual(2);
  });

  it('stops watching after unsubscribe', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url });
    const received: InboxMessage[] = [];
    const stop = t.subscribe('topic-e', { onMessage: (m) => received.push(m) });
    await waitFor(() => mock.openStreams() === 1, 2000, 'stream open');
    stop();
    await waitFor(() => mock.openStreams() === 0, 2000, 'stream closed');
    await t.publish('topic-e', 'late');
    await new Promise((r) => setTimeout(r, 100));
    expect(received).toHaveLength(0);
  });

  it('reports a failed publish', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url });
    mock.state.failPublish = true;
    await expect(t.publish('topic-f', 'x')).rejects.toThrow(/HTTP 500/);
  });

  it('survives an unreachable server by retrying', async () => {
    const t = new NtfyTransport({ baseUrl: 'http://127.0.0.1:1', retryMs: 20, maxRetryMs: 40 });
    const statuses: string[] = [];
    stops.push(t.subscribe('topic-g', { onMessage: () => undefined, onStatus: (s) => statuses.push(s) }));
    await waitFor(() => statuses.filter((s) => s === 'disconnected').length >= 2, 2000, 'retries');
  });

  it('picks up a message missed because the cache lags, with a catch-up read', async () => {
    mock.state.cacheDelayMs = 400;
    const t = new NtfyTransport({ baseUrl: mock.url, catchUpDelayMs: 700 });
    // Published just before anyone watches: not live for the new subscriber, not yet replayable.
    await t.publish('topic-h', 'just before');
    const received = watch(t, 'topic-h', '5m');
    await new Promise((r) => setTimeout(r, 150));
    expect(received).toHaveLength(0);
    await waitFor(() => received.length === 1, 3000, 'catch-up message');
    expect(received[0]?.message).toBe('just before');
  });

  it('delivers a message once even when the stream and the catch-up read both see it', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url, catchUpDelayMs: 100 });
    await t.publish('topic-i', 'once');
    const received = watch(t, 'topic-i', '5m');
    await new Promise((r) => setTimeout(r, 500));
    expect(received.map((m) => m.message)).toEqual(['once']);
  });

  it('resumes from a message id, not from the stream open event', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url, retryMs: 20, maxRetryMs: 40, catchUpDelayMs: 0 });
    const received = watch(t, 'topic-j', '5m');
    await waitFor(() => mock.openStreams() === 1, 2000, 'stream open');
    await t.publish('topic-j', 'a');
    await waitFor(() => received.length === 1, 2000, 'first');
    mock.dropStreams();
    await t.publish('topic-j', 'b');
    await waitFor(() => received.length === 2, 3000, 'second');
    await new Promise((r) => setTimeout(r, 150));
    expect(received.map((m) => m.message)).toEqual(['a', 'b']);
  });

  it('waits longer before retrying after 429 Too Many Requests', async () => {
    mock.state.rateLimitSubscribes = 1;
    const t = new NtfyTransport({ baseUrl: mock.url, retryMs: 20, rateLimitedRetryMs: 400, catchUpDelayMs: 0 });
    const statuses: { s: string; at: number }[] = [];
    const t0 = Date.now();
    stops.push(t.subscribe('topic-k', { onMessage: () => undefined, onStatus: (s) => statuses.push({ s, at: Date.now() - t0 }) }));
    await waitFor(() => statuses.some((x) => x.s === 'connected'), 3000, 'connected after the limit');
    const connectedAt = statuses.find((x) => x.s === 'connected')?.at ?? 0;
    expect(statuses[0]?.s).toBe('disconnected');
    expect(connectedAt).toBeGreaterThanOrEqual(350);
  });

  it('reports activity for any event on the stream, including the open event', async () => {
    const t = new NtfyTransport({ baseUrl: mock.url, catchUpDelayMs: 0 });
    let activity = 0;
    stops.push(t.subscribe('topic-l', { onMessage: () => undefined, onActivity: () => activity++ }));
    await waitFor(() => activity >= 1, 2000, 'activity from the open event');
  });
});
