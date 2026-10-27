import qrcode from 'qrcode-generator';

export interface QrMatrix {
  size: number;
  /** Row-major, true for a dark module. */
  dark: boolean[];
}

export function makeQr(text: string): QrMatrix {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  const size = qr.getModuleCount();
  const dark: boolean[] = [];
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) dark.push(qr.isDark(r, c));
  return { size, dark };
}

/** One SVG path (in module units) covering every dark module; rendered inside a quiet-zone border. */
export function matrixPath(m: QrMatrix): string {
  let d = '';
  for (let r = 0; r < m.size; r++) {
    let c = 0;
    while (c < m.size) {
      if (!m.dark[r * m.size + c]) {
        c++;
        continue;
      }
      const start = c;
      while (c < m.size && m.dark[r * m.size + c]) c++;
      d += `M${start} ${r}h${c - start}v1h-${c - start}z`;
    }
  }
  return d;
}

export const QUIET_ZONE = 4;
