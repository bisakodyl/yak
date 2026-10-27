import { describe, expect, it } from 'vitest';
import { DEFAULT_MAX_MESSAGE, Joiner, LINK_CHUNK, pieceSize, split } from './link-chunks';

function bytes(n: number, first = 1): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 7 + 13) % 256;
  b[0] = first;
  return b;
}

function roundTrip(message: Uint8Array, size: number): { pieces: Uint8Array[]; out: Uint8Array[] } {
  const pieces = split(message, size);
  const joiner = new Joiner();
  const out = pieces.map((p) => joiner.receive(p)).filter((m): m is Uint8Array => m !== undefined);
  return { pieces, out };
}

describe('link chunks', () => {
  it('sends a message that fits unchanged', () => {
    const m = bytes(100);
    expect(split(m, 1000)).toEqual([m]);
    expect(new Joiner().receive(m)).toBe(m);
  });

  it('splits a large message into pieces no larger than the limit and joins it', () => {
    const m = bytes(300_003);
    const { pieces, out } = roundTrip(m, 16 * 1024);
    expect(pieces.length).toBe(19);
    expect(pieces.every((p) => p.length <= 16 * 1024 && p[0] === LINK_CHUNK)).toBe(true);
    expect(out).toEqual([m]);
  });

  it('handles a message exactly one byte over the limit, and an exact multiple', () => {
    for (const n of [1001, 998 * 3]) expect(roundTrip(bytes(n), 1000).out).toEqual([bytes(n)]);
  });

  it('wraps a small message whose first byte is the chunk marker', () => {
    const m = bytes(10, LINK_CHUNK);
    expect(roundTrip(m, 1000).out).toEqual([m]);
  });

  it('keeps small messages between large ones in order', () => {
    const joiner = new Joiner();
    const sent = [bytes(50_000), bytes(10, 2), bytes(70_000)];
    const out = sent.flatMap((m) => split(m, 16_384)).map((p) => joiner.receive(p)).filter(Boolean);
    expect(out).toEqual(sent);
  });

  it('picks a piece size from the reported limit', () => {
    expect(pieceSize(undefined)).toBe(DEFAULT_MAX_MESSAGE);
    expect(pieceSize(null)).toBe(DEFAULT_MAX_MESSAGE);
    expect(pieceSize(0)).toBe(DEFAULT_MAX_MESSAGE);
    expect(pieceSize(262_144)).toBe(65_536);
    expect(pieceSize(Infinity)).toBe(65_536);
    expect(pieceSize(8_000)).toBe(8_000);
  });
});
