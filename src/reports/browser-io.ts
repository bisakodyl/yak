import { type DateRange, dayKey } from './dates';

/** Clipboard and download helpers. Every browser capability is feature-detected. */

/** Copy text; resolves `false` when the browser refuses so the caller can show the text instead. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'rp-offscreen';
    document.body.append(area);
    area.select();
    const ok = typeof document.execCommand === 'function' && document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Offer text as a file download. A byte-order mark makes spreadsheet programs read UTF-8 correctly. */
export function downloadText(fileName: string, text: string, type: string, withBom = false): void {
  const blob = new Blob(withBom ? ['﻿', text] : [text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.className = 'rp-offscreen';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function csvFileName(range: DateRange): string {
  const a = dayKey(range.from);
  const b = dayKey(range.to - 1);
  return a === b ? `time-entries-${a}.csv` : `time-entries-${a}_to_${b}.csv`;
}
