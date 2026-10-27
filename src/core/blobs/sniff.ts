/**
 * What a file really is, from its bytes. Display is decided here, never from the declared type or
 * the extension (docs/architecture.md "Files in notes"): only these four raster formats are ever shown inline.
 */

export type InlineImageType = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';

const ascii = (b: Uint8Array, at: number, s: string): boolean => {
  if (at + s.length > b.length) return false;
  for (let i = 0; i < s.length; i++) if (b[at + i] !== s.charCodeAt(i)) return false;
  return true;
};

export function sniffImage(b: Uint8Array): InlineImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 'PNG') && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return 'image/webp';
  if (ascii(b, 0, 'GIF87a') || ascii(b, 0, 'GIF89a')) return 'image/gif';
  return null;
}

// ---- Location data ------------------------------------------------------------------------------

/** Does a TIFF block (EXIF) hold a GPS position? Walks IFD0 for the GPS pointer (0x8825) and its latitude (tag 2). */
function tiffHasGps(b: Uint8Array, start: number): boolean {
  if (start + 8 > b.length) return false;
  const little = b[start] === 0x49 && b[start + 1] === 0x49;
  if (!little && !(b[start] === 0x4d && b[start + 1] === 0x4d)) return false;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o: number): number => v.getUint16(o, little);
  const u32 = (o: number): number => v.getUint32(o, little);
  try {
    if (u16(start + 2) !== 42) return false;
    const ifd0 = start + u32(start + 4);
    const n = u16(ifd0);
    for (let i = 0; i < n && i < 512; i++) {
      const e = ifd0 + 2 + i * 12;
      if (u16(e) !== 0x8825) continue;
      const gps = start + u32(e + 8);
      const count = u16(gps);
      for (let j = 0; j < count && j < 64; j++) {
        const tag = u16(gps + 2 + j * 12);
        if (tag === 2 || tag === 4) return true; // GPSLatitude or GPSLongitude
      }
      return false;
    }
  } catch {
    return false; // a truncated or odd block: nothing we can read
  }
  return false;
}

function jpegHasGps(b: Uint8Array): boolean {
  let p = 2;
  while (p + 4 < b.length && b[p] === 0xff) {
    const marker = b[p + 1] ?? 0;
    if (marker === 0xda) return false; // start of scan: no more metadata
    const len = ((b[p + 2] ?? 0) << 8) | (b[p + 3] ?? 0);
    if (marker === 0xe1 && ascii(b, p + 4, 'Exif\0\0') && tiffHasGps(b, p + 10)) return true;
    p += 2 + len;
  }
  return false;
}

function pngHasGps(b: Uint8Array): boolean {
  let p = 8;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  while (p + 12 <= b.length) {
    const len = v.getUint32(p);
    if (ascii(b, p + 4, 'eXIf') && tiffHasGps(b, p + 8)) return true;
    if (ascii(b, p + 4, 'IDAT')) return false;
    p += 12 + len;
  }
  return false;
}

function webpHasGps(b: Uint8Array): boolean {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let p = 12;
  while (p + 8 <= b.length) {
    const len = v.getUint32(p + 4, true);
    if (ascii(b, p, 'EXIF')) return tiffHasGps(b, p + 8 + (ascii(b, p + 8, 'Exif\0\0') ? 6 : 0));
    p += 8 + len + (len & 1);
  }
  return false;
}

/** HEIC and friends: the EXIF item is a TIFF block somewhere after an `Exif` marker. */
function heicHasGps(b: Uint8Array): boolean {
  for (let i = 4; i + 12 < b.length; i++) {
    if (!ascii(b, i, 'Exif')) continue;
    for (let j = i + 4; j < i + 24 && j + 4 < b.length; j++) {
      const tiff = (b[j] === 0x49 && b[j + 1] === 0x49 && b[j + 2] === 0x2a) || (b[j] === 0x4d && b[j + 1] === 0x4d && b[j + 3] === 0x2a);
      if (tiff && tiffHasGps(b, j)) return true;
    }
  }
  return false;
}

/** MP4 and MOV keep a position in the `©xyz` atom (an ISO 6709 string such as +48.85-002.35/). */
function movHasGps(b: Uint8Array): boolean {
  for (let i = 0; i + 4 <= b.length; i++) {
    if (b[i] === 0xa9 && ascii(b, i + 1, 'xyz')) return true;
  }
  return false;
}

/** Common formats only: JPEG, PNG, WebP, HEIC, MP4, MOV. Anything else is not scanned. */
export function hasLocationData(b: Uint8Array): boolean {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8) return jpegHasGps(b);
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 'PNG')) return pngHasGps(b);
  if (ascii(b, 0, 'RIFF') && ascii(b, 8, 'WEBP')) return webpHasGps(b);
  if (ascii(b, 4, 'ftyp')) {
    const brand = String.fromCharCode(b[8] ?? 0, b[9] ?? 0, b[10] ?? 0, b[11] ?? 0);
    if (/^(heic|heix|hevc|mif1|msf1|heim|heis)/.test(brand)) return heicHasGps(b);
    return movHasGps(b);
  }
  return false;
}
