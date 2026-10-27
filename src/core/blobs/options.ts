/** Device-only option "Shrink large photos" (`image_downscale`, off by default). Never in a document. */

const KEY = 'image_downscale';

export function readShrinkPhotos(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function saveShrinkPhotos(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // The option still applies to this visit's reads of the saved value only if storage works.
  }
}
