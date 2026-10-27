import type * as Y from 'yjs';

/**
 * Names, removals and departures of the owner's devices, in the account document's `devices` map, so
 * every device shows the same names and keeps out a device removed on any of them. A device that
 * leaves the account marks itself `left`: the others stop listing it, and it clears the mark when it
 * joins again.
 *
 * Keys are `<deviceId>:name` and `<deviceId>:removed` with plain values, so two devices changing
 * different fields at once never drop each other's change (a nested map per device would: two
 * devices creating the same key keep only one).
 *
 * Removal is cooperative, not security: a removed device still holds the pairing code. Keeping a
 * lost device out for good means changing the code (docs/sync.md, "Trust limit").
 */

export interface DeviceInfo {
  name?: string;
  /** Removed by another device: blocked until allowed again. */
  removed: boolean;
  /** Left the account of its own accord: not listed, not blocked. */
  left: boolean;
}

const DEVICES_MAP = 'devices';
const MAX_NAME = 40;

export function devicesMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap<unknown>(DEVICES_MAP);
}

export function readDevices(doc: Y.Doc | undefined): Map<string, DeviceInfo> {
  const out = new Map<string, DeviceInfo>();
  if (!doc) return out;
  devicesMap(doc).forEach((value, key) => {
    const i = key.lastIndexOf(':');
    if (i <= 0) return;
    const id = key.slice(0, i);
    const field = key.slice(i + 1);
    const info = out.get(id) ?? { removed: false, left: false };
    if (field === 'name' && typeof value === 'string' && value.trim()) info.name = value.trim();
    if (field === 'removed') info.removed = value === true;
    if (field === 'left') info.left = value === true;
    out.set(id, info);
  });
  return out;
}

export function deviceName(doc: Y.Doc | undefined, id: string): string | undefined {
  const v = doc ? devicesMap(doc).get(`${id}:name`) : undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

export function isRemoved(doc: Y.Doc | undefined, id: string): boolean {
  return doc ? devicesMap(doc).get(`${id}:removed`) === true : false;
}

export function isLeft(doc: Y.Doc | undefined, id: string): boolean {
  return doc ? devicesMap(doc).get(`${id}:left`) === true : false;
}

/** A device says it has left the account (or that it is back). */
export function setLeft(doc: Y.Doc, id: string, left: boolean): void {
  if (left) devicesMap(doc).set(`${id}:left`, true);
  else devicesMap(doc).delete(`${id}:left`);
}

/** Set or clear a device's name (empty clears it). Returns the stored name. */
export function setDeviceName(doc: Y.Doc, id: string, name: string): string | undefined {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  if (clean) devicesMap(doc).set(`${id}:name`, clean);
  else devicesMap(doc).delete(`${id}:name`);
  return clean || undefined;
}

export function setRemoved(doc: Y.Doc, id: string, removed: boolean): void {
  if (removed) devicesMap(doc).set(`${id}:removed`, true);
  else devicesMap(doc).delete(`${id}:removed`);
}

/** A starting name from the browser, such as "Firefox on Android". */
export function suggestedName(userAgent: string): string {
  const ua = userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}
