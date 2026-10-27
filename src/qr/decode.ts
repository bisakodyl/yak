export interface FrameSource {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

type JsQr = typeof import('jsqr').default;

type BarcodeDetectorCtor = new (opts: { formats: string[] }) => { detect(src: ImageBitmapSource): Promise<{ rawValue: string }[]> };

/** Decode a QR code from raw RGBA pixels with the JS decoder; null when none is found. */
export function decodePixels(jsQR: JsQr, frame: FrameSource): string | null {
  return jsQR(frame.data, frame.width, frame.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Returns a decoder that prefers the native BarcodeDetector and falls back to jsQR. */
export async function createDecoder(canvas: HTMLCanvasElement): Promise<() => Promise<string | null>> {
  const BD = (globalThis as { BarcodeDetector?: BarcodeDetectorCtor & { getSupportedFormats?(): Promise<string[]> } }).BarcodeDetector;
  let jsQR: JsQr | undefined;
  let native: InstanceType<BarcodeDetectorCtor> | undefined;
  try {
    if (BD && (!BD.getSupportedFormats || (await BD.getSupportedFormats()).includes('qr_code'))) native = new BD({ formats: ['qr_code'] });
  } catch {
    native = undefined;
  }
  return async () => {
    if (native) {
      try {
        const found = await native.detect(canvas);
        return found[0]?.rawValue ?? null;
      } catch {
        // fall through to the JS decoder
      }
    }
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || canvas.width === 0) return null;
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
    // The JS decoder (about 270 KB) loads only when the browser has no native detector.
    jsQR ??= (await import('jsqr')).default;
    return decodePixels(jsQR, image);
  };
}
