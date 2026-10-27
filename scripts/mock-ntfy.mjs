// A small local stand-in for ntfy, for tests and offline development. It implements only what
// Yak uses: POST /<topic>, a Server-Sent-Events stream at /<topic>/sse with `since`
// (a duration, a message id or `all`), CORS, and /v1/health. Messages are cached in memory.
//
//   node scripts/mock-ntfy.mjs 8089        # then use http://localhost:8089 as the signaling server
//
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const DURATION = /^(\d+)([smhd])$/;
const UNIT_SECONDS = { s: 1, m: 60, h: 3600, d: 86400 };

function sinceFilter(since, cache, nowSeconds) {
  if (!since || since === 'all') return cache.slice();
  const d = DURATION.exec(since);
  if (d) {
    const cutoff = nowSeconds - Number(d[1]) * UNIT_SECONDS[d[2]];
    return cache.filter((m) => m.time >= cutoff);
  }
  const index = cache.findIndex((m) => m.id === since);
  return index >= 0 ? cache.slice(index + 1) : cache.slice();
}

/**
 * @param {{ port?: number, now?: () => number }} [options]
 */
export async function startMockNtfy(options = {}) {
  const now = options.now ?? (() => Date.now());
  /** @type {Map<string, any[]>} */
  const caches = new Map();
  /** @type {Set<{ topic: string, res: import('node:http').ServerResponse }>} */
  const streams = new Set();
  let counter = 0;
  const state = { failPublish: false, publishes: 0, subscribes: 0, cacheDelayMs: 0, rateLimitSubscribes: 0 };

  const cors = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': '*',
    'access-control-allow-methods': 'GET, PUT, POST, PATCH, DELETE',
  };

  /** Cached messages for a topic as they are sent on the wire, honouring `since` and cache lag. */
  const backlogFor = (topic, since) => {
    const visible = (caches.get(topic) ?? []).filter((x) => x.visibleAt <= Date.now());
    return sinceFilter(since, visible, Math.floor(now() / 1000)).map(({ visibleAt: _v, ...wire }) => wire);
  };

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (req.method === 'OPTIONS') {
      res.writeHead(200, cors);
      res.end();
      return;
    }
    if (url.pathname === '/v1/health') {
      res.writeHead(200, { ...cors, 'content-type': 'application/json' });
      res.end('{"healthy":true}');
      return;
    }
    const parts = url.pathname.split('/').filter(Boolean);
    const topic = parts[0];
    if (!topic) {
      res.writeHead(404, cors);
      res.end();
      return;
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      state.publishes++;
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        if (state.failPublish) {
          res.writeHead(500, cors);
          res.end('{"error":"mock failure"}');
          return;
        }
        // Like ntfy, cache writes may lag: the message is live at once but replayable only later.
        const message = {
          id: `m${String(++counter).padStart(8, '0')}`,
          time: Math.floor(now() / 1000),
          event: 'message',
          topic,
          message: body,
          visibleAt: Date.now() + state.cacheDelayMs,
        };
        const cache = caches.get(topic) ?? [];
        cache.push(message);
        caches.set(topic, cache);
        const { visibleAt: _hidden, ...wire } = message;
        for (const s of streams) {
          if (s.topic === topic) s.res.write(`data: ${JSON.stringify(wire)}\n\n`);
        }
        res.writeHead(200, { ...cors, 'content-type': 'application/json' });
        res.end(JSON.stringify(message));
      });
      return;
    }
    if (req.method === 'GET' && parts[1] === 'json') {
      // Poll: the cached messages as one JSON object per line, then the response ends.
      const lines = backlogFor(topic, url.searchParams.get('since')).map((x) => JSON.stringify(x)).join('\n');
      res.writeHead(200, { ...cors, 'content-type': 'application/x-ndjson' });
      res.end(lines ? lines + '\n' : '');
      return;
    }
    if (req.method === 'GET' && parts[1] === 'sse') {
      state.subscribes++;
      if (state.rateLimitSubscribes > 0) {
        // Answer the next N stream requests with 429, like ntfy over its per-IP budget.
        state.rateLimitSubscribes--;
        res.writeHead(429, { ...cors, 'content-type': 'application/json' });
        res.end('{"code":42901,"http":429,"error":"limit reached: too many requests"}');
        return;
      }
      res.writeHead(200, { ...cors, 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: open\ndata: ${JSON.stringify({ id: 'open', time: Math.floor(now() / 1000), event: 'open', topic })}\n\n`);
      for (const m of backlogFor(topic, url.searchParams.get('since'))) res.write(`data: ${JSON.stringify(m)}\n\n`);
      const entry = { topic, res };
      streams.add(entry);
      req.on('close', () => streams.delete(entry));
      return;
    }
    res.writeHead(404, cors);
    res.end();
  });

  await new Promise((resolve) => server.listen(options.port ?? 0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    state,
    /** Messages cached for a topic, oldest first. */
    messages: (topic) => (caches.get(topic) ?? []).map(({ visibleAt: _v, ...wire }) => wire),
    /** End every open stream, as a proxy timeout or a restart would. */
    dropStreams() {
      for (const s of streams) s.res.end();
      streams.clear();
    },
    openStreams: () => streams.size,
    close() {
      for (const s of streams) s.res.end();
      streams.clear();
      return new Promise((resolve) => server.close(() => resolve(undefined)));
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.argv[2] ?? 8089);
  const mock = await startMockNtfy({ port });
  console.log(`mock ntfy listening on ${mock.url}`);
}
