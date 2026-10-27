import { NotFoundError, isSafePath, type BackupDir } from './dir';
import { decodeText, encodeText } from './format';

/**
 * A store-only (no compression) zip writer and reader, with ZIP64 so one download can pass 4 GB
 * (decision N-166l). The writer builds a `Blob` out of parts, so file bytes that are already a
 * `Blob` are never held in one buffer; the reader reads only what the writer produces (and what
 * ordinary tools make of it: store-only entries, optional ZIP64 records).
 */

export interface ZipInput {
  path: string;
  data: Uint8Array | Blob;
}

const U32 = 0xffffffff;
const U16 = 0xffff;
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_LOC64 = 0x07064b50;
const UTF8 = 0x0800;

let table: Uint32Array | undefined;
function crcTable(): Uint32Array {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  return table;
}

export function crc32Update(crc: number, data: Uint8Array): number {
  const t = crcTable();
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]!) & 0xff]! ^ (c >>> 8);
  return ~c >>> 0;
}

async function crcOf(data: Uint8Array | Blob): Promise<number> {
  if (data instanceof Uint8Array) return crc32Update(0, data);
  let crc = 0;
  const reader = data.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32Update(crc, value);
  }
}

function dosTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return { time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate() };
}

class Out {
  private readonly view: DataView;
  readonly bytes: Uint8Array;
  private at = 0;
  constructor(size: number) {
    this.bytes = new Uint8Array(size);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number): void {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
  }
  u32(v: number): void {
    this.view.setUint32(this.at, v, true);
    this.at += 4;
  }
  u64(v: number): void {
    this.view.setBigUint64(this.at, BigInt(v), true);
    this.at += 8;
  }
  raw(b: Uint8Array): void {
    this.bytes.set(b, this.at);
    this.at += b.length;
  }
}

export interface ZipOptions {
  now?: Date;
  /** Sizes and offsets at or over this use ZIP64 records. Tests lower it; real archives use the format's 4 GiB - 1. */
  limit?: number;
}

/** Build the archive as one Blob of parts. Entry order is kept. */
export async function zipBlob(entries: readonly ZipInput[], o: ZipOptions = {}): Promise<Blob> {
  const limit = o.limit ?? U32;
  const { time, date } = dosTime(o.now ?? new Date());
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    if (!isSafePath(e.path)) throw new Error(`Unsafe path in zip: ${e.path}`);
    const name = encodeText(e.path);
    const size = e.data instanceof Uint8Array ? e.data.length : e.data.size;
    const crc = await crcOf(e.data);
    const big = size >= limit;
    // The local header carries both sizes in a ZIP64 extra field when the file is that large.
    const lx = big ? 20 : 0;
    const local = new Out(30 + name.length + lx);
    local.u32(SIG_LOCAL);
    local.u16(big ? 45 : 20);
    local.u16(UTF8);
    local.u16(0);
    local.u16(time);
    local.u16(date);
    local.u32(crc);
    local.u32(big ? U32 : size);
    local.u32(big ? U32 : size);
    local.u16(name.length);
    local.u16(lx);
    local.raw(name);
    if (big) {
      local.u16(1);
      local.u16(16);
      local.u64(size);
      local.u64(size);
    }
    parts.push(local.bytes as Uint8Array<ArrayBuffer>, e.data as BlobPart);

    const atBig = offset >= limit;
    const extra = (big ? 16 : 0) + (atBig ? 8 : 0);
    const cx = extra ? extra + 4 : 0;
    const c = new Out(46 + name.length + cx);
    c.u32(SIG_CENTRAL);
    c.u16(big || atBig ? 45 : 20);
    c.u16(big || atBig ? 45 : 20);
    c.u16(UTF8);
    c.u16(0);
    c.u16(time);
    c.u16(date);
    c.u32(crc);
    c.u32(big ? U32 : size);
    c.u32(big ? U32 : size);
    c.u16(name.length);
    c.u16(cx);
    c.u16(0);
    c.u16(0);
    c.u16(0);
    c.u32(0);
    c.u32(atBig ? U32 : offset);
    c.raw(name);
    if (cx) {
      c.u16(1);
      c.u16(extra);
      if (big) {
        c.u64(size);
        c.u64(size);
      }
      if (atBig) c.u64(offset);
    }
    central.push(c.bytes);
    offset += local.bytes.length + size;
  }
  const cdSize = central.reduce((n, b) => n + b.length, 0);
  const cdOffset = offset;
  parts.push(...(central as Uint8Array<ArrayBuffer>[]));
  const zip64 = entries.length >= U16 || cdSize >= limit || cdOffset >= limit;
  if (zip64) {
    const rec = new Out(56);
    rec.u32(SIG_EOCD64);
    rec.u64(44);
    rec.u16(45);
    rec.u16(45);
    rec.u32(0);
    rec.u32(0);
    rec.u64(entries.length);
    rec.u64(entries.length);
    rec.u64(cdSize);
    rec.u64(cdOffset);
    const loc = new Out(20);
    loc.u32(SIG_LOC64);
    loc.u32(0);
    loc.u64(cdOffset + cdSize);
    loc.u32(1);
    parts.push(rec.bytes as Uint8Array<ArrayBuffer>, loc.bytes as Uint8Array<ArrayBuffer>);
  }
  const end = new Out(22);
  end.u32(SIG_EOCD);
  end.u16(0);
  end.u16(0);
  end.u16(zip64 ? U16 : entries.length);
  end.u16(zip64 ? U16 : entries.length);
  end.u32(zip64 ? U32 : cdSize);
  end.u32(zip64 ? U32 : cdOffset);
  end.u16(0);
  parts.push(end.bytes as Uint8Array<ArrayBuffer>);
  return new Blob(parts, { type: 'application/zip' });
}

// ---- Reader

export interface ZipEntry {
  path: string;
  size: number;
  crc: number;
  /** Offset of the local header. */
  offset: number;
}

export class ZipArchive {
  constructor(
    private readonly blob: Blob,
    readonly entries: ReadonlyMap<string, ZipEntry>,
  ) {}

  has(path: string): boolean {
    return this.entries.has(path);
  }

  /** The bytes of an entry as a lazy slice of the archive: nothing is read until it is used. */
  async slice(path: string): Promise<Blob> {
    const e = this.entries.get(path);
    if (!e) throw new NotFoundError(path);
    const head = new DataView(await this.blob.slice(e.offset, e.offset + 30).arrayBuffer());
    if (head.byteLength < 30 || head.getUint32(0, true) !== SIG_LOCAL) throw new Error(`${path}: damaged zip entry`);
    const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    return this.blob.slice(start, start + e.size);
  }

  async read(path: string): Promise<Uint8Array> {
    const data = new Uint8Array(await (await this.slice(path)).arrayBuffer());
    const e = this.entries.get(path) as ZipEntry;
    if (crc32Update(0, data) !== e.crc) throw new Error(`${path} does not match the checksum in the zip`);
    return data;
  }
}

const big = (v: bigint): number => {
  if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The zip is too large to read here.');
  return Number(v);
};

export async function readZip(blob: Blob): Promise<ZipArchive> {
  const tailLen = Math.min(blob.size, 22 + 20 + U16);
  const tail = new Uint8Array(await blob.slice(blob.size - tailLen).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('The file is not a zip archive.');
  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);
  if (count === U16 || cdSize === U32 || cdOffset === U32) {
    if (eocd < 20 || tv.getUint32(eocd - 20, true) !== SIG_LOC64) throw new Error('The zip archive is damaged (no ZIP64 locator).');
    const at = big(tv.getBigUint64(eocd - 20 + 8, true));
    const rec = new DataView(await blob.slice(at, at + 56).arrayBuffer());
    if (rec.byteLength < 56 || rec.getUint32(0, true) !== SIG_EOCD64) throw new Error('The zip archive is damaged (bad ZIP64 record).');
    count = big(rec.getBigUint64(32, true));
    cdSize = big(rec.getBigUint64(40, true));
    cdOffset = big(rec.getBigUint64(48, true));
  }
  const cd = new Uint8Array(await blob.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const v = new DataView(cd.buffer);
  const entries = new Map<string, ZipEntry>();
  let p = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.length || v.getUint32(p, true) !== SIG_CENTRAL) throw new Error('The zip archive is damaged (bad directory).');
    const method = v.getUint16(p + 10, true);
    const crc = v.getUint32(p + 16, true);
    let size = v.getUint32(p + 24, true);
    let offset = v.getUint32(p + 42, true);
    const nameLen = v.getUint16(p + 28, true);
    const extraLen = v.getUint16(p + 30, true);
    const commentLen = v.getUint16(p + 32, true);
    const path = decodeText(cd.subarray(p + 46, p + 46 + nameLen));
    if (method !== 0) throw new Error(`${path} is compressed; Yak reads only the zip files it wrote.`);
    let x = p + 46 + nameLen;
    const xEnd = x + extraLen;
    while (x + 4 <= xEnd) {
      const id = v.getUint16(x, true);
      const len = v.getUint16(x + 2, true);
      if (id === 1) {
        // Only the fields that hold 0xFFFFFFFF appear, in this order.
        let q = x + 4;
        if (v.getUint32(p + 24, true) === U32) {
          size = big(v.getBigUint64(q, true));
          q += 8;
        }
        if (v.getUint32(p + 20, true) === U32) q += 8;
        if (v.getUint32(p + 42, true) === U32) offset = big(v.getBigUint64(q, true));
      }
      x += 4 + len;
    }
    if (!path.endsWith('/')) entries.set(path, { path, size, crc, offset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return new ZipArchive(blob, entries);
}

/** A read-only `BackupDir` over a zip, so the ordinary restore reads it like a backup folder. */
export class ZipDir implements BackupDir {
  constructor(readonly zip: ZipArchive) {}
  async writeFile(): Promise<void> {
    throw new Error('A zip file is read-only.');
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.zip.read(path);
  }
  async listDirs(path: string): Promise<string[]> {
    const prefix = path === '' ? '' : `${path}/`;
    const out = new Set<string>();
    for (const f of this.zip.entries.keys()) if (f.startsWith(prefix)) {
      const rest = f.slice(prefix.length).split('/');
      if (rest.length > 1 && rest[0]) out.add(rest[0]);
    }
    return [...out].sort();
  }
  async listFiles(path: string): Promise<string[]> {
    const prefix = path === '' ? '' : `${path}/`;
    return [...this.zip.entries.keys()].filter((f) => f.startsWith(prefix) && !f.slice(prefix.length).includes('/')).map((f) => f.slice(prefix.length)).sort();
  }
  async exists(path: string): Promise<boolean> {
    return this.zip.has(path);
  }
}
