import { describe, expect, it } from 'vitest';
import { parseUserAgent } from './browser';
import { classifyCandidate } from './probes';

describe('parseUserAgent', () => {
  it('detects Edge before Chrome', () => {
    const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.2849.5';
    expect(parseUserAgent(ua)).toEqual({ name: 'Edge', version: '130.0.2849.5' });
  });
  it('detects Chrome', () => {
    const ua = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
    expect(parseUserAgent(ua).name).toBe('Chrome');
  });
  it('detects Firefox and Safari', () => {
    expect(parseUserAgent('Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0').name).toBe('Firefox');
    expect(parseUserAgent('Mozilla/5.0 (Macintosh) AppleWebKit/605 (KHTML, like Gecko) Version/17.0 Safari/605').name).toBe('Safari');
  });
});

describe('classifyCandidate', () => {
  it('classifies candidate types', () => {
    expect(classifyCandidate('candidate:1 1 udp 2113937151 abcd-1234.local 5000 typ host')).toBe('host-mdns');
    expect(classifyCandidate('candidate:1 1 udp 2113937151 192.168.1.5 5000 typ host')).toBe('host-ip');
    expect(classifyCandidate('candidate:2 1 udp 1677729535 1.2.3.4 5000 typ srflx raddr 0.0.0.0')).toBe('srflx');
  });
});
