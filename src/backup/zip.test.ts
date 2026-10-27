import { describe, expect, it } from 'vitest';
import { ZipDir, crc32Update, readZip, zipBlob } from './zip';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32Update(0, enc('123456789'))).toBe(0xcbf43926);
  });

  it('round-trips stored entries, Blobs and UTF-8 names', async () => {
    const zip = await zipBlob([
      { path: 'manifest.json', data: enc('{"a":1}') },
      { path: 'docs/space~x/attachments/Ünï.txt', data: new Blob(['hello ', 'blob']) },
      { path: 'empty', data: new Uint8Array() },
    ]);
    const read = await readZip(zip);
    expect([...read.entries.keys()]).toEqual(['manifest.json', 'docs/space~x/attachments/Ünï.txt', 'empty']);
    expect(new TextDecoder().decode(await read.read('docs/space~x/attachments/Ünï.txt'))).toBe('hello blob');
    expect((await read.read('empty')).length).toBe(0);
    const dir = new ZipDir(read);
    expect(await dir.listDirs('docs')).toEqual(['space~x']);
    expect(await dir.listFiles('')).toEqual(['empty', 'manifest.json']);
  });

  it('uses ZIP64 records past the limit and reads them back', async () => {
    const entries = [
      { path: 'a.bin', data: enc('0123456789') },
      { path: 'b.bin', data: enc('abcdefghij') },
      { path: 'c.bin', data: enc('xyz') },
    ];
    // A limit of 15 bytes forces: a 10-byte file below it, offsets past it, and the ZIP64 end records.
    const zip = await zipBlob(entries, { limit: 15 });
    const plain = await zipBlob(entries);
    expect(zip.size).toBeGreaterThan(plain.size);
    const read = await readZip(zip);
    expect(new TextDecoder().decode(await read.read('b.bin'))).toBe('abcdefghij');
    expect(new TextDecoder().decode(await read.read('c.bin'))).toBe('xyz');
    // Entries of 16 bytes or more carry their sizes in ZIP64 extra fields too.
    const big = await zipBlob([{ path: 'big', data: enc('0123456789abcdef') }, { path: 'after', data: enc('tail') }], { limit: 15 });
    const r2 = await readZip(big);
    expect(new TextDecoder().decode(await r2.read('big'))).toBe('0123456789abcdef');
    expect(new TextDecoder().decode(await r2.read('after'))).toBe('tail');
  });

  it('refuses unsafe paths, non-zip data and a damaged entry', async () => {
    await expect(zipBlob([{ path: '../x', data: enc('x') }])).rejects.toThrow(/Unsafe/);
    await expect(readZip(new Blob(['not a zip at all, really not']))).rejects.toThrow(/not a zip/);
    const bytes = new Uint8Array(await (await zipBlob([{ path: 'f', data: enc('data') }])).arrayBuffer());
    bytes[30 + 1] = (bytes[30 + 1] ?? 0) ^ 0xff; // the file's own byte (header is 30 bytes + 1 name byte)
    const read = await readZip(new Blob([bytes]));
    await expect(read.read('f')).rejects.toThrow(/checksum/);
  });
});
