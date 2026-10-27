import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addAttachment, cleanFileName, findAttachment, listAttachments, uniqueFileName } from './attachments';
import { MAX_FILE_BYTES, MAX_UNIT_BYTES } from './limits';
import { hasLocationData, sniffImage } from './sniff';
import { MemoryBlobStore } from './store';

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const file = (bytes: number[] | Uint8Array, name: string, type = ''): File => new File([new Uint8Array(bytes)], name, { type });

/** A minimal JPEG whose EXIF block holds a GPS latitude entry. */
function jpegWithGps(): Uint8Array {
  const tiff = [
    0x4d, 0x4d, 0, 42, 0, 0, 0, 8, // header, IFD0 at 8
    0, 1, 0x88, 0x25, 0, 4, 0, 0, 0, 1, 0, 0, 0, 26, // one entry: GPS pointer to offset 26
    0, 0, 0, 0, // next IFD
    0, 1, 0, 2, 0, 5, 0, 0, 0, 3, 0, 0, 0, 0, // GPS IFD: one entry, tag 2 (latitude)
  ];
  const exif = [...'Exif\0\0'].map((c) => c.charCodeAt(0)).concat(tiff);
  const len = exif.length + 2;
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe1, len >> 8, len & 255, ...exif, 0xff, 0xda, 0, 2]);
}

describe('sniffImage', () => {
  it('knows the four inline formats from their bytes', () => {
    expect(sniffImage(new Uint8Array(PNG))).toBe('image/png');
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
  });
  it('never calls SVG or HTML an image, whatever the name says', () => {
    expect(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffImage(new TextEncoder().encode('<html><script>alert(1)</script>'))).toBeNull();
  });
});

describe('hasLocationData', () => {
  it('finds a GPS entry in JPEG EXIF', () => expect(hasLocationData(jpegWithGps())).toBe(true));
  it('is false for a plain JPEG, PNG and text', () => {
    expect(hasLocationData(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 2, 0xff, 0xda]))).toBe(false);
    expect(hasLocationData(new Uint8Array(PNG))).toBe(false);
    expect(hasLocationData(new TextEncoder().encode('hello'))).toBe(false);
  });
  it('finds the © xyz atom of a MOV', () => {
    const b = new Uint8Array([0, 0, 0, 16, ...'ftypqt  '.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 9, 0xa9, 0x78, 0x79, 0x7a]);
    expect(hasLocationData(b)).toBe(true);
  });
});

describe('names', () => {
  it('strips what would break a link', () => expect(cleanFileName('a/b|c[d].png')).toBe('b-c-d-.png'));
  it('adds a 2 suffix before the extension', () => {
    expect(uniqueFileName('a.png', ['A.png'])).toBe('a 2.png');
    expect(uniqueFileName('a.png', ['a.png', 'a 2.png'])).toBe('a 3.png');
    expect(uniqueFileName('b.png', ['a.png'])).toBe('b.png');
  });
});

describe('addAttachment', () => {
  const noQuota = async () => undefined;
  it('stores bytes by hash and indexes them', async () => {
    const doc = new Y.Doc();
    const store = new MemoryBlobStore();
    const r = await addAttachment(doc, store, file(PNG, 'a.png', 'image/svg+xml'), { estimate: noQuota });
    expect(r.ok && r.attachment.type).toBe('image/png');
    expect(store.files.size).toBe(1);
    expect(listAttachments(doc)).toHaveLength(1);
    expect(findAttachment(doc, 'A.PNG')?.name).toBe('a.png');
  });
  it('stores a declared image that is really HTML as an opaque file', async () => {
    const doc = new Y.Doc();
    const r = await addAttachment(doc, new MemoryBlobStore(), file(new TextEncoder().encode('<html>'), 'x.png', 'image/png'), { estimate: noQuota });
    expect(r.ok && r.attachment.type).toBe('application/octet-stream');
  });
  it('keeps one entry for the same bytes', async () => {
    const doc = new Y.Doc();
    const store = new MemoryBlobStore();
    await addAttachment(doc, store, file(PNG, 'a.png'), { estimate: noQuota });
    const again = await addAttachment(doc, store, file(PNG, 'b.png'), { estimate: noQuota });
    expect(again.ok && again.reused).toBe(true);
    expect(listAttachments(doc)).toHaveLength(1);
  });
  it('suffixes a clash on the name', async () => {
    const doc = new Y.Doc();
    const store = new MemoryBlobStore();
    await addAttachment(doc, store, file([1, 2, 3], 'n.txt'), { estimate: noQuota });
    const r = await addAttachment(doc, store, file([4, 5, 6], 'n.txt'), { estimate: noQuota });
    expect(r.ok && r.attachment.name).toBe('n 2.txt');
  });
  it('names a pasted screenshot', async () => {
    const r = await addAttachment(new Y.Doc(), new MemoryBlobStore(), file(PNG, 'image.png'), { estimate: noQuota, now: new Date(2026, 9, 20, 15, 30, 12) });
    expect(r.ok && r.attachment.name).toBe('Pasted image 20261020-153012.png');
  });
  it('refuses over 10 MB and says the sizes', async () => {
    const r = await addAttachment(new Y.Doc(), new MemoryBlobStore(), file(new Uint8Array(MAX_FILE_BYTES + 1), 'big.bin'), { estimate: noQuota });
    expect(!r.ok && r.error).toMatch(/10(\.0)? MB/);
  });
  it('refuses a file that would pass 1 GB', async () => {
    const store = new MemoryBlobStore();
    store.totalSize = async () => MAX_UNIT_BYTES - 2;
    const r = await addAttachment(new Y.Doc(), store, file([1, 2, 3, 4], 'x.bin'), { estimate: noQuota });
    expect(r.ok).toBe(false);
  });
  it('warns at 80% of the unit and of the browser quota', async () => {
    const store = new MemoryBlobStore();
    store.totalSize = async () => MAX_UNIT_BYTES * 0.8;
    const full = await addAttachment(new Y.Doc(), store, file([1], 'a.bin'), { estimate: noQuota });
    expect(full.ok && full.notices.join()).toMatch(/80%/);
    const browser = await addAttachment(new Y.Doc(), new MemoryBlobStore(), file([1], 'a.bin'), { estimate: async () => ({ usage: 90, quota: 100 }) });
    expect(browser.ok && browser.notices.join()).toMatch(/80%/);
  });
  it('warns about location data and adds the file unchanged', async () => {
    const store = new MemoryBlobStore();
    const r = await addAttachment(new Y.Doc(), store, file(jpegWithGps(), 'p.jpg'), { estimate: noQuota });
    expect(r.ok && r.notices.join()).toMatch(/location data/);
    const rec = [...store.files.values()][0]!;
    expect(rec.size).toBe(jpegWithGps().length);
  });
  it('asks the browser to persist storage with the first file only', async () => {
    let asked = 0;
    const persist = async () => void asked++;
    const store = new MemoryBlobStore();
    await addAttachment(new Y.Doc(), store, file([1], 'a.bin'), { estimate: noQuota, persist });
    await addAttachment(new Y.Doc(), store, file([2], 'b.bin'), { estimate: noQuota, persist });
    expect(asked).toBe(1);
  });
  it('reads an absent attachments map as empty', () => expect(listAttachments(new Y.Doc())).toEqual([]));
});
