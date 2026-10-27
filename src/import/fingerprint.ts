/**
 * Stable fingerprint of an imported entry, stored on the entry as `import_id`.
 * It is built from what identifies the work (start, end, description, project, client), so
 * importing the same export again, or an overlapping one, finds the entries already there.
 * Tags and the billable flag are left out on purpose: editing them after the import must not
 * make a second import add the entry again.
 */

const IMPORT_ID_PREFIX = 'toggl-csv:v1:';

/** Two 64-bit passes of a simple string hash, 128 bits in all; collisions are not a practical concern. */
function hash128(text: string): string {
  let out = '';
  for (const seed of [0x9e3779b9, 0x85ebca6b]) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    out += (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

export interface FingerprintInput {
  /** ISO 8601 UTC, as stored on the entry. */
  start: string;
  stop: string;
  description: string;
  project: string;
  client: string;
}

export function importId(e: FingerprintInput): string {
  const key = [e.start, e.stop, e.description.trim(), e.project.trim().toLowerCase(), e.client.trim().toLowerCase()].join('␟');
  return IMPORT_ID_PREFIX + hash128(key);
}
