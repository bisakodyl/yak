import { RELAY_SERVICE } from '../core/protocol-ids';
import { isRelayUrl } from './transport-factory';

/** One hour of relay use for one kind of message (`signal` or `link`), from `GET /signal/admin/stats` (worker/index.ts). */
export interface NetworkRow {
  hour: string;
  kind: string;
  rooms: number;
  messages: number;
  bytes: number;
}

export interface NetworkSummary {
  /** Most rooms active in any single hour. */
  peakRooms: number;
  messages: number;
  bytes: number;
  /** Share of bytes carried by relay data links (the fallback), 0 to 1. */
  linkShare: number;
}

export function adminStatsUrl(signalingUrl: string, hours: number): string | undefined {
  const url = signalingUrl.trim();
  if (!isRelayUrl(url)) return undefined;
  return url.replace(/^ws(s?):\/\//i, (_, s: string) => `http${s}://`).replace(/\/+$/, '') + `/admin/stats?hours=${hours}`;
}

export type NetworkResult = { ok: true; rows: NetworkRow[] } | { ok: false; reason: 'key' | 'off' | 'failed' };

export async function fetchNetworkStats(signalingUrl: string, key: string, hours = 24, fetchImpl: typeof fetch = fetch): Promise<NetworkResult> {
  const url = adminStatsUrl(signalingUrl, hours);
  if (!url) return { ok: false, reason: 'off' };
  try {
    const response = await fetchImpl(url, { cache: 'no-store', headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15000) });
    if (response.status === 401) return { ok: false, reason: 'key' };
    if (response.status === 404) return { ok: false, reason: 'off' };
    const body = (await response.json()) as { service?: unknown; rows?: unknown };
    if (!response.ok || body.service !== RELAY_SERVICE || !Array.isArray(body.rows)) return { ok: false, reason: 'failed' };
    const rows = (body.rows as Record<string, unknown>[]).map((r) => ({
      hour: String(r.hour ?? ''),
      kind: String(r.kind ?? ''),
      rooms: Number(r.rooms) || 0,
      messages: Number(r.messages) || 0,
      bytes: Number(r.bytes) || 0,
    }));
    return { ok: true, rows };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

export function summarize(rows: readonly NetworkRow[]): NetworkSummary {
  const perHour = new Map<string, number>();
  let messages = 0;
  let bytes = 0;
  let linkBytes = 0;
  for (const r of rows) {
    // Rooms are counted per kind; the larger of the two is the hour's active rooms (a room may use both).
    perHour.set(r.hour, Math.max(perHour.get(r.hour) ?? 0, r.rooms));
    messages += r.messages;
    bytes += r.bytes;
    if (r.kind === 'link') linkBytes += r.bytes;
  }
  return { peakRooms: Math.max(0, ...perHour.values()), messages, bytes, linkShare: bytes > 0 ? linkBytes / bytes : 0 };
}
