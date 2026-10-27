import * as Y from 'yjs';
import { base64, encodeText } from './bytes';
import type { AccountKeyRecord } from './account-keys';
import { spacesMap } from './account';
import { verifyCert, type DeviceCert } from './key-certs';
import { removalTag, verifyRemoval, type Removal } from './key-removals';
import { fingerprint, isPublicKeyJwk, sign, verifyText, type PublicKeyJwk } from './keys';

/**
 * Sharing a space with another account (#259, S-259). A share is a space whose own document holds a
 * signed roster in a `share` map (never in the private part or the log):
 *
 * - `share`: { owner, key, secret, sig }, signed by the owner's account key. The secret names the share mesh.
 * - `member:<fp>`: { key, n, sig }, signed by the owner: the account `fp` is a member at generation `n`.
 * - `end:<fp>:<n>`: { sig }, signed by the owner: that generation ended.
 * - `cert:<fp>:<deviceId>` / `removal:<fp>:<deviceId>`: verbatim copies of a member account's approved
 *   certificate and signed removal, so other accounts can verify its devices (signed by that account).
 * - `name:<fp>`: a display name, unsigned (cosmetic).
 *
 * Every grant is signed and bound to the share's space id. Each device trusts the owner key by a
 * fingerprint in its own account document (`spaces.<S>:share`, the anchor), written when it compared codes.
 * Ends and removals it has seen are pinned on the device, so deleting a record changes nothing there.
 */

const SHARE_LABEL = 'yak/v1/share\u0000';
const MEMBER_LABEL = 'yak/v1/member\u0000';
const END_LABEL = 'yak/v1/share-end\u0000';

export const SHARE_MAP = 'share';
const FP = /^[a-f0-9]{32}$/;
const DEVICE_ID = /^[A-Za-z0-9-]{1,64}$/;
/** The records a roster may hold; anything else sent by a peer is left out. */
const ROSTER_RECORD = /^(?:share|member:[a-f0-9]{32}|end:[a-f0-9]{32}:\d{1,9}|(?:cert|removal):[a-f0-9]{32}:[A-Za-z0-9-]{1,64}|name:[a-f0-9]{32})$/;
const NAME_MAX = 80;
/** A pairing secret in its normalized form (`normalizeSecret`): 28 base32 characters. */
const SECRET = /^[A-Z2-7]{28}$/;

export const shareMap = (doc: Y.Doc): Y.Map<unknown> => doc.getMap<unknown>(SHARE_MAP);

const shareText = (space: string, owner: string, key: PublicKeyJwk, secret: string): string => SHARE_LABEL + JSON.stringify([space, owner, key.x, key.y, secret]);
const memberText = (space: string, fp: string, key: PublicKeyJwk, n: number): string => MEMBER_LABEL + JSON.stringify([space, fp, key.x, key.y, n]);
const endText = (space: string, fp: string, n: number): string => END_LABEL + JSON.stringify([space, fp, n]);

const signed = async (priv: CryptoKey, text: string): Promise<string> => base64(await sign(priv, encodeText(text)));

const asRecord = (fp: string, key: PublicKeyJwk): AccountKeyRecord => ({ fingerprint: fp, publicKey: key, by: '', at: 0, sealed: false });

// --- the anchor in this account's own document ---

/** The owner fingerprint this account trusts for the space, or undefined when the space is not a share here. */
export function shareAnchor(account: Y.Doc, space: string): string | undefined {
  const v = spacesMap(account).get(`${space}:share`);
  return typeof v === 'string' && FP.test(v) ? v : undefined;
}

export function setShareAnchor(account: Y.Doc, space: string, owner: string): void {
  if (shareAnchor(account, space) !== owner) spacesMap(account).set(`${space}:share`, owner);
}

/** Leave a share: the space stays here as an ordinary space. */
export function clearShareAnchor(account: Y.Doc, space: string): void {
  spacesMap(account).delete(`${space}:share`);
}

/** Every space this account takes part in as a share, with the owner it trusts. */
export function sharedSpaces(account: Y.Doc): Map<string, string> {
  const out = new Map<string, string>();
  spacesMap(account).forEach((v, k) => {
    if (!k.endsWith(':share') || typeof v !== 'string' || !FP.test(v)) return;
    out.set(k.slice(0, -':share'.length), v);
  });
  return out;
}

// --- pins ---

/** What this device saw and never forgets about one share (a record deleted afterwards changes nothing). */
export interface SharePins {
  /** The highest ended generation seen per account. */
  ends: Record<string, number>;
  /** Removal tags (`deviceId:signKeyFingerprint`) seen in the roster. */
  removed: string[];
}

export interface SharePinStore {
  load(space: string): SharePins;
  save(space: string, pins: SharePins): void;
}

export const emptyPins = (): SharePins => ({ ends: {}, removed: [] });

/** Pins in memory (tests). */
export function memoryPins(): SharePinStore & { all: Map<string, SharePins> } {
  const all = new Map<string, SharePins>();
  return {
    all,
    load: (s) => structuredClone(all.get(s) ?? emptyPins()),
    save: (s, p) => void all.set(s, structuredClone(p)),
  };
}

// --- reading ---

export interface ShareMember {
  fp: string;
  key: PublicKeyJwk;
  /** The generation; the owner is 0. */
  n: number;
  name?: string;
}

export interface ShareState {
  space: string;
  owner: string;
  /** The pairing secret of the share mesh. */
  secret: string;
  /** Active members, the owner included. */
  members: Map<string, ShareMember>;
  /** Accounts whose membership ended, with the ended generation (from records and pins). */
  ended: Map<string, number>;
  /** Device id to the certificate of the one active member account that vouches for it (peers and own account's other devices). */
  devices: Map<string, { fp: string; cert: DeviceCert }>;
}

const isNat = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 999_999_999;

function nameOf(doc: Y.Doc, fp: string): string | undefined {
  const v = shareMap(doc).get(`name:${fp}`);
  return typeof v === 'string' && v.trim() ? v.slice(0, NAME_MAX) : undefined;
}

/** The share record: valid only when its owner is the anchor, the key hashes to it and the owner signed it. */
async function readShareRecord(doc: Y.Doc, space: string, anchor: string): Promise<{ owner: string; key: PublicKeyJwk; secret: string } | undefined> {
  const v = shareMap(doc).get('share') as { owner?: unknown; key?: unknown; secret?: unknown; sig?: unknown } | undefined;
  if (!v || v.owner !== anchor || !isPublicKeyJwk(v.key) || typeof v.secret !== 'string' || typeof v.sig !== 'string') return undefined;
  if ((await fingerprint(v.key)) !== anchor) return undefined;
  if (!SECRET.test(v.secret)) return undefined;
  return (await verifyText(v.key, shareText(space, anchor, v.key, v.secret), v.sig)) ? { owner: anchor, key: v.key, secret: v.secret } : undefined;
}

/**
 * Work out a share from its roster: undefined when the space is not a share on this device (no anchor
 * or no valid `share` record). Valid ends and removals are added to the pins (and saved) on the way,
 * so a record deleted later changes nothing here.
 */
export async function readShare(doc: Y.Doc, space: string, anchor: string | undefined, pinStore: SharePinStore): Promise<ShareState | undefined> {
  if (!anchor) return undefined;
  const head = await readShareRecord(doc, space, anchor);
  if (!head) return undefined;
  const ownerRec = asRecord(head.owner, head.key);
  const pins = pinStore.load(space);
  const before = JSON.stringify(pins);

  // Ends signed by the owner, then pinned.
  const endChecks: Promise<[string, number] | undefined>[] = [];
  shareMap(doc).forEach((value, key) => {
    const m = /^end:([a-f0-9]{32}):(\d{1,9})$/.exec(key);
    const sig = (value as { sig?: unknown } | undefined)?.sig;
    if (!m || typeof sig !== 'string') return;
    const fp = m[1] as string;
    const n = Number(m[2]);
    if (!isNat(n)) return;
    endChecks.push(verifyText(head.key, endText(space, fp, n), sig).then((ok) => (ok ? [fp, n] : undefined)));
  });
  for (const e of await Promise.all(endChecks)) if (e && (pins.ends[e[0]] ?? 0) < e[1]) pins.ends[e[0]] = e[1];

  // Members signed by the owner whose generation is above every end seen.
  const members = new Map<string, ShareMember>();
  members.set(head.owner, { fp: head.owner, key: head.key, n: 0, ...optName(nameOf(doc, head.owner)) });
  const memberChecks: Promise<ShareMember | undefined>[] = [];
  shareMap(doc).forEach((value, key) => {
    const m = /^member:([a-f0-9]{32})$/.exec(key);
    const v = value as { key?: unknown; n?: unknown; sig?: unknown } | undefined;
    if (!m || !v || !isPublicKeyJwk(v.key) || !isNat(v.n) || typeof v.sig !== 'string') return;
    const fp = m[1] as string;
    if (fp === head.owner) return;
    const k = v.key;
    const n = v.n;
    const sig = v.sig;
    memberChecks.push(
      (async () => ((await fingerprint(k)) === fp && (await verifyText(head.key, memberText(space, fp, k, n), sig)) ? { fp, key: k, n, ...optName(nameOf(doc, fp)) } : undefined))(),
    );
  });
  const ended = new Map<string, number>(Object.entries(pins.ends));
  for (const m of await Promise.all(memberChecks)) {
    if (!m) continue;
    if (m.n > (pins.ends[m.fp] ?? 0)) members.set(m.fp, m);
  }

  // Copies of the members' certificates and removals, each checked against that member's key.
  const certChecks: Promise<{ fp: string; cert: DeviceCert } | undefined>[] = [];
  const removalChecks: Promise<Removal | undefined>[] = [];
  shareMap(doc).forEach((value, key) => {
    const m = /^(cert|removal):([a-f0-9]{32}):([A-Za-z0-9-]{1,64})$/.exec(key);
    if (!m) return;
    const fp = m[2] as string;
    const id = m[3] as string;
    const member = members.get(fp);
    const account = member ? asRecord(fp, member.key) : fp === head.owner ? ownerRec : undefined;
    if (!account) return;
    if (m[1] === 'cert') certChecks.push(verifyCert(id, value, account).then((cert) => (cert && cert.v === 2 ? { fp, cert } : undefined)));
    else removalChecks.push(verifyRemoval(id, value, account));
  });
  const removedSeen = new Set(pins.removed);
  for (const r of await Promise.all(removalChecks)) if (r) removedSeen.add(removalTag(r));
  pins.removed = [...removedSeen].sort();

  const byDevice = new Map<string, { fp: string; cert: DeviceCert }[]>();
  for (const c of await Promise.all(certChecks)) {
    if (!c) continue;
    if (removedSeen.has(removalTag({ deviceId: c.cert.deviceId, key: await fingerprint(c.cert.sign) }))) continue;
    byDevice.set(c.cert.deviceId, [...(byDevice.get(c.cert.deviceId) ?? []), c]);
  }
  // A device id certified under two accounts counts for neither.
  const devices = new Map<string, { fp: string; cert: DeviceCert }>();
  for (const [id, list] of byDevice) if (list.length === 1) devices.set(id, list[0] as { fp: string; cert: DeviceCert });

  if (JSON.stringify(pins) !== before) pinStore.save(space, pins);
  return { space, owner: head.owner, secret: head.secret, members, ended, devices };
}

const optName = (name: string | undefined): { name?: string } => (name ? { name } : {});

// --- writing (the owner) ---

/** Make the space a share: the owner's signed `share` record with `secret` (a fresh normalized pairing secret). An existing record of this owner is kept. Returns the secret in use. */
export async function createShare(doc: Y.Doc, space: string, ownerFp: string, ownerKey: PublicKeyJwk, priv: CryptoKey, secret: string, name?: string): Promise<string> {
  const existing = shareMap(doc).get('share') as { owner?: unknown; secret?: unknown } | undefined;
  if (existing?.owner === ownerFp && typeof existing.secret === 'string') return existing.secret;
  if (!SECRET.test(secret)) throw new Error('The share secret is not a pairing secret.');
  const sig = await signed(priv, shareText(space, ownerFp, ownerKey, secret));
  doc.transact(() => {
    shareMap(doc).set('share', { owner: ownerFp, key: ownerKey, secret, sig });
    if (name) setShareName(doc, ownerFp, name);
  });
  return secret;
}

export function setShareName(doc: Y.Doc, fp: string, name: string): void {
  const clean = name.replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (clean && shareMap(doc).get(`name:${fp}`) !== clean) shareMap(doc).set(`name:${fp}`, clean);
}

/** The generation a member joining now gets: above every record of that account and every end seen. */
export function nextGeneration(doc: Y.Doc, fp: string, pins: SharePins): number {
  let max = pins.ends[fp] ?? 0;
  const own = shareMap(doc).get(`member:${fp}`) as { n?: unknown } | undefined;
  if (isNat(own?.n)) max = Math.max(max, own.n);
  shareMap(doc).forEach((_v, k) => {
    const m = /^end:([a-f0-9]{32}):(\d{1,9})$/.exec(k);
    if (m && m[1] === fp) max = Math.max(max, Number(m[2]));
  });
  return max + 1;
}

/** The certificates and removals an asking account sent that its own key signed, as roster entries. Everything else is left out. */
export async function rosterRecordsFor(fp: string, key: PublicKeyJwk, records: readonly [string, unknown][]): Promise<[string, unknown][]> {
  if ((await fingerprint(key)) !== fp) return [];
  const account = asRecord(fp, key);
  const out: [string, unknown][] = [];
  for (const [k, v] of records.slice(0, 64)) {
    const m = /^(cert|removal):([A-Za-z0-9-]{1,64})$/.exec(k);
    if (!m || !DEVICE_ID.test(m[2] as string)) continue;
    const id = m[2] as string;
    if (m[1] === 'cert' ? (await verifyCert(id, v, account))?.v === 2 : await verifyRemoval(id, v, account)) out.push([`${m[1]}:${fp}:${id}`, v]);
  }
  return out;
}

/** The owner adds an account as a member at generation `n`, with the records its devices sent, in one transaction. */
export async function addMember(doc: Y.Doc, space: string, priv: CryptoKey, member: { fp: string; key: PublicKeyJwk; n: number; name?: string }, records: readonly [string, unknown][]): Promise<void> {
  const sig = await signed(priv, memberText(space, member.fp, member.key, member.n));
  doc.transact(() => {
    shareMap(doc).set(`member:${member.fp}`, { key: member.key, n: member.n, sig });
    if (member.name) setShareName(doc, member.fp, member.name);
    for (const [k, v] of records) shareMap(doc).set(k, v);
  });
}

/** The owner ends a member's generation. The record is pinned on every device that sees it. */
export async function endMember(doc: Y.Doc, space: string, priv: CryptoKey, fp: string, n: number): Promise<void> {
  const sig = await signed(priv, endText(space, fp, n));
  shareMap(doc).set(`end:${fp}:${n}`, { sig });
}

// --- copying a member account's own records into the roster ---

const stable = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));

export interface OwnRecords {
  /** This device's account. */
  fp: string;
  /** Its approved certificates (`readCerts(…, approved = true, removed)`). */
  certs: ReadonlyMap<string, DeviceCert>;
  /** Its signed removals. */
  removals: readonly Removal[];
  /** The account document's `keys` map, where the raw records are. */
  keys: Y.Map<unknown>;
}

/**
 * A device of an active member account copies that account's approved certificates and signed removals
 * into the roster when they are absent or different. Never for another account, never deletes. Returns
 * how many records it wrote.
 */
export function copyOwnRecords(doc: Y.Doc, state: ShareState, own: OwnRecords): number {
  if (!state.members.has(own.fp)) return 0;
  const writes: [string, unknown][] = [];
  const consider = (key: string, raw: unknown): void => {
    if (raw !== undefined && stable(shareMap(doc).get(key)) !== stable(raw)) writes.push([key, raw]);
  };
  for (const id of own.certs.keys()) consider(`cert:${own.fp}:${id}`, own.keys.get(`cert:${id}`));
  for (const r of own.removals) consider(`removal:${own.fp}:${r.deviceId}`, own.keys.get(`removal:${r.deviceId}`));
  if (writes.length === 0) return 0;
  doc.transact(() => {
    for (const [k, v] of writes) shareMap(doc).set(k, v);
  });
  return writes.length;
}

// --- carrying a roster to a new member ---

/** Every roster record, for the `approved` message to a new member. */
export function rosterRecords(doc: Y.Doc): [string, unknown][] {
  const out: [string, unknown][] = [];
  shareMap(doc).forEach((v, k) => {
    if (ROSTER_RECORD.test(k)) out.push([k, v]);
  });
  return out;
}

/** Roster records received from a peer, as far as their keys are well formed. */
export function acceptableRoster(records: readonly [string, unknown][]): [string, unknown][] {
  return records.filter((r): r is [string, unknown] => Array.isArray(r) && typeof r[0] === 'string' && ROSTER_RECORD.test(r[0])).slice(0, 512);
}

/** Put roster records into a space document (a new member's first copy); readers verify each one. */
export function applyRoster(doc: Y.Doc, records: readonly [string, unknown][]): void {
  doc.transact(() => {
    for (const [k, v] of records) shareMap(doc).set(k, v);
  });
}
