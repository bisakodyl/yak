/**
 * Splits messages larger than the data channel allows and joins them again on the other side.
 * The channel is ordered and reliable, so pieces arrive in order and need no index.
 *
 * A piece starts with LINK_CHUNK, then 1 (more follow) or 0 (last), then the bytes.
 * Messages that fit are sent unchanged, so a device without this code still gets every small
 * message; doc-mux frame types never use LINK_CHUNK as their first byte.
 */
export const LINK_CHUNK = 3;

/** Used when the browser does not report a limit; every WebRTC stack accepts this. */
export const DEFAULT_MAX_MESSAGE = 16 * 1024;

/** Pieces stay this small even when the peer allows more, so one send never holds the queue long. */
const MAX_PIECE = 64 * 1024;

/** A joined message larger than this is dropped (the periodic re-sync repairs the gap). */
const MAX_JOINED = 64 * 1024 * 1024;

const HEADER = 2;

/** The piece size for a channel whose peer accepts messages up to `maxMessageSize` bytes. */
export function pieceSize(maxMessageSize: number | null | undefined): number {
  const limit = typeof maxMessageSize === 'number' && maxMessageSize > HEADER ? maxMessageSize : DEFAULT_MAX_MESSAGE;
  return Math.min(limit, MAX_PIECE);
}

/** The message itself when it fits in one piece, else the pieces to send in order. */
export function split(message: Uint8Array, size: number): Uint8Array[] {
  if (message.length <= size && message[0] !== LINK_CHUNK) return [message];
  const step = size - HEADER;
  const pieces: Uint8Array[] = [];
  for (let at = 0; at < message.length; at += step) {
    const body = message.subarray(at, at + step);
    const piece = new Uint8Array(HEADER + body.length);
    piece[0] = LINK_CHUNK;
    piece[1] = at + step < message.length ? 1 : 0;
    piece.set(body, HEADER);
    pieces.push(piece);
  }
  return pieces;
}

/** Joins pieces received on one channel; one instance per channel. */
export class Joiner {
  private parts: Uint8Array[] = [];
  private size = 0;

  /** The whole message once complete, the message itself when it was not split, else undefined. */
  receive(data: Uint8Array): Uint8Array | undefined {
    if (data[0] !== LINK_CHUNK || data.length < HEADER) return data;
    this.size += data.length - HEADER;
    if (this.size > MAX_JOINED) {
      this.reset();
      return undefined;
    }
    this.parts.push(data.subarray(HEADER));
    if (data[1] === 1) return undefined;
    const whole = new Uint8Array(this.size);
    let at = 0;
    for (const p of this.parts) {
      whole.set(p, at);
      at += p.length;
    }
    this.reset();
    return whole;
  }

  private reset(): void {
    this.parts = [];
    this.size = 0;
  }
}
