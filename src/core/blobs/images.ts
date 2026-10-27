import { DISPLAY_MAX_SIDE } from './limits';
import type { InlineImageType } from './sniff';

/** Image helpers on top of the canvas. Every function degrades to "no result" where the browser lacks a feature. */

export async function imageSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const size = { width: bmp.width, height: bmp.height };
    bmp.close();
    return size;
  } catch {
    return null;
  }
}

/** Re-encode `blob` so its long side is at most `maxSide`; null when it is already small or the browser cannot. */
export async function downscale(blob: Blob, type: InlineImageType, maxSide = DISPLAY_MAX_SIDE): Promise<Blob | null> {
  if (type === 'image/gif' || typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(blob);
    const long = Math.max(bmp.width, bmp.height);
    if (long <= maxSide) {
      bmp.close();
      return null;
    }
    const scale = maxSide / long;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob((b) => resolve(b), type, 0.9));
  } catch {
    return null;
  }
}
