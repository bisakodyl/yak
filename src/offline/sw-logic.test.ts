import { describe, expect, it } from 'vitest';
import { CACHE_PREFIX, cacheName, isClientMessage, pageKey, routeRequest, staleCaches } from './sw-logic';

const SCOPE = 'https://app.example/';
const pages = new Set(['', 'probe']);
const assets = new Set(['assets/main-abc.js', 'assets/editor-def.js', 'assets/main-123.css']);
const get = (url: string, mode = 'cors', extra: Record<string, string> = {}) =>
  routeRequest({ url, method: 'GET', mode, ...extra }, SCOPE, pages, assets);

describe('routeRequest', () => {
  it('serves precached hashed files cache first, including the lazy editor chunk', () => {
    expect(get('https://app.example/assets/main-abc.js')).toEqual({ kind: 'asset', key: 'https://app.example/assets/main-abc.js' });
    expect(get('https://app.example/assets/editor-def.js', 'no-cors').kind).toBe('asset');
    expect(get('https://app.example/assets/main-123.css').kind).toBe('asset');
  });

  it('maps page loads to their canonical cached page, ignoring query and hash', () => {
    expect(get('https://app.example/', 'navigate')).toEqual({ kind: 'page', key: 'https://app.example/' });
    expect(get('https://app.example/?test#/notes', 'navigate')).toEqual({ kind: 'page', key: 'https://app.example/' });
    expect(get('https://app.example/index.html', 'navigate')).toEqual({ kind: 'page', key: 'https://app.example/' });
    expect(get('https://app.example/probe', 'navigate')).toEqual({ kind: 'page', key: 'https://app.example/probe' });
  });

  it('leaves unknown pages and unknown files to the network', () => {
    expect(get('https://app.example/other', 'navigate').kind).toBe('bypass');
    expect(get('https://app.example/assets/old-zzz.js').kind).toBe('bypass');
    expect(get('https://app.example/assets/main-abc.js?v=2').kind).toBe('bypass');
    // A page URL fetched by script is not a page load.
    expect(get('https://app.example/').kind).toBe('bypass');
  });

  it('never touches the signaling relay, the probe worker scope or worker scripts', () => {
    expect(get('https://app.example/signal/abc').kind).toBe('bypass');
    expect(get('https://app.example/signal/abc', 'navigate').kind).toBe('bypass');
    expect(get('https://app.example/probe/', 'navigate').kind).toBe('bypass');
    expect(get('https://app.example/probe/x.js').kind).toBe('bypass');
    expect(get('https://app.example/probe-sw.js').kind).toBe('bypass');
    expect(get('https://app.example/sw.js').kind).toBe('bypass');
  });

  it('never touches cross-origin or non-GET requests', () => {
    expect(get('https://ntfy.sh/topic/json').kind).toBe('bypass');
    expect(get('https://api.github.com/gists/1').kind).toBe('bypass');
    expect(get('http://app.example/assets/main-abc.js').kind).toBe('bypass');
    expect(routeRequest({ url: 'https://app.example/assets/main-abc.js', method: 'POST', mode: 'cors' }, SCOPE, pages, assets).kind).toBe('bypass');
    expect(routeRequest({ url: 'https://app.example/', method: 'HEAD', mode: 'navigate' }, SCOPE, pages, assets).kind).toBe('bypass');
  });

  it('skips the DevTools only-if-cached quirk and bad URLs', () => {
    expect(get('https://app.example/assets/main-abc.js', 'no-cors', { cache: 'only-if-cached' }).kind).toBe('bypass');
    expect(get('not a url').kind).toBe('bypass');
  });

  it('works under a sub-path scope', () => {
    const r = routeRequest({ url: 'https://h.example/pd/assets/main-abc.js', method: 'GET', mode: 'cors' }, 'https://h.example/pd/', pages, assets);
    expect(r).toEqual({ kind: 'asset', key: 'https://h.example/pd/assets/main-abc.js' });
    expect(routeRequest({ url: 'https://h.example/pd/', method: 'GET', mode: 'navigate' }, 'https://h.example/pd/', pages, assets).kind).toBe('page');
    expect(routeRequest({ url: 'https://h.example/assets/main-abc.js', method: 'GET', mode: 'cors' }, 'https://h.example/pd/', pages, assets).kind).toBe('bypass');
  });
});

describe('pageKey', () => {
  it('turns HTML file names into page paths', () => {
    expect(pageKey('index.html')).toBe('');
    expect(pageKey('probe.html')).toBe('probe');
    expect(pageKey('docs/index.html')).toBe('docs/');
    expect(pageKey('probe')).toBe('probe');
  });
});

describe('caches', () => {
  it('names caches after the version and finds only our stale ones', () => {
    const current = cacheName('v2');
    expect(current).toBe(`${CACHE_PREFIX}v2`);
    expect(staleCaches([cacheName('v1'), current, 'someone-else', cacheName('v0')], current)).toEqual([cacheName('v1'), cacheName('v0')]);
  });
});

describe('isClientMessage', () => {
  it('accepts only the known messages', () => {
    expect(isClientMessage({ type: 'SKIP_WAITING' })).toBe(true);
    expect(isClientMessage({ type: 'GET_VERSION' })).toBe(true);
    expect(isClientMessage({ type: 'OTHER' })).toBe(false);
    expect(isClientMessage(null)).toBe(false);
    expect(isClientMessage('SKIP_WAITING')).toBe(false);
  });
});
