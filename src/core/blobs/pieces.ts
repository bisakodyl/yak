/**
 * Pieces of a file for transfer between devices (docs/architecture.md "Files in notes", "Transfer"): fixed
 * 60 KiB so a frame with its header stays under the 64 KiB link piece; the last piece is shorter.
 * `pieces` in the index is the SHA-256 of the concatenated piece hashes, so a receiver can check a
 * piece-hash list from a peer before asking for any bytes.
 */

export const PIECE_SIZE = 60 * 1024;

const hex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

export function pieceCount(size: number): number {
  return Math.ceil(size / PIECE_SIZE);
}

/** Byte range of piece `i` in a file of `size` bytes. */
export function pieceRange(size: number, i: number): [number, number] {
  return [i * PIECE_SIZE, Math.min(size, (i + 1) * PIECE_SIZE)];
}

export async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data as BufferSource));
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  return hex(await sha256Bytes(data));
}

/** Hex SHA-256 of every piece, in order. */
export async function pieceHashes(bytes: Uint8Array): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < pieceCount(bytes.length); i++) {
    const [a, b] = pieceRange(bytes.length, i);
    out.push(await sha256Hex(bytes.subarray(a, b)));
  }
  return out;
}

/** The `pieces` index value: SHA-256 of the piece hashes joined as hex. */
export async function pieceListHash(hashes: string[]): Promise<string> {
  return sha256Hex(new TextEncoder().encode(hashes.join('')));
}
