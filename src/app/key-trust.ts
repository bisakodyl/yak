import type * as Y from 'yjs';
import { readSpaces } from '../core/account';
import { readAccountKeys, readDeviceKeys } from '../core/account-keys';
import { certifyDevice, certMatches, keysRequired, readCerts, type DeviceCert } from '../core/key-certs';
import { maintainGrants, readGrants, type SpaceGrants } from '../core/key-grants';
import { readRemovals, removalTag, type Removal } from '../core/key-removals';
import { isLeft, isRemoved } from '../core/devices';
import { fingerprint, type DeviceKeyPairs } from '../core/keys';
import type { DeviceProof, PeerKeys, SyncIdentity } from '../sync/handshake';

/**
 * What this device knows about certified keys (#256), read synchronously by the sync layer and the
 * filter; refreshed from the account document whenever its keys, devices, spaces or choices change.
 */
export class KeyTrust implements SyncIdentity {
  accountFp: string | undefined;
  isRequired = false;
  certs = new Map<string, DeviceCert>();
  grants = new Map<string, SpaceGrants>();
  /** Devices with a signed removal of their keys (#258). */
  removedDevices = new Set<string>();
  proof: DeviceProof | undefined;
  /**
   * This device's keys while it has no approval it can see (keys required): it still signs, so a peer
   * that approved it meanwhile verifies the link and sends the account document with the approval.
   * Only a peer holding an approval for exactly these keys accepts the signature.
   */
  signer: DeviceProof | undefined;
  private readonly listeners = new Set<() => void>();

  /** Called after the trust changed (pages showing approvals re-render). */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  changed(): void {
    for (const l of this.listeners) l();
  }

  own(): DeviceProof | undefined {
    return this.proof ?? (this.isRequired ? this.signer : undefined);
  }

  peer(peerId: string): PeerKeys | undefined {
    const c = this.certs.get(peerId);
    return c ? { sign: c.sign, agree: c.agree } : undefined;
  }

  required(): boolean {
    return this.isRequired;
  }

  /**
   * Never connect to this device. With keys required: a signed removal of its keys and no approval for
   * new ones (the plain flag is ignored, #258). Otherwise the cooperative flag (`flag`), as before.
   */
  blocked(deviceId: string, flag: boolean): boolean {
    return this.isRequired ? this.removedDevices.has(deviceId) && !this.certs.has(deviceId) : flag;
  }

  /** The device holds the current key of the space. */
  holds(spaceId: string, deviceId: string): boolean {
    return this.grants.get(spaceId)?.holders.has(deviceId) ?? false;
  }

  /** A short summary: when it changes, sync works out pair keys and the filter again. */
  summary(): string {
    return JSON.stringify([this.accountFp, this.isRequired, !!this.proof, !!this.signer, [...this.removedDevices].sort(), [...this.certs.keys()].sort(), [...this.grants].map(([s, g]) => [s, g.epoch, g.kid, [...g.holders].sort()]).sort()]);
  }
}

export interface TrustInputs {
  doc: Y.Doc;
  /** The account key this device follows (its pin), if any. */
  fp: string | undefined;
  me: string;
  own: DeviceKeyPairs | null;
  /** The account private key when this device holds it (its creator before sealing, or unlocked): certifies on first use in compatible mode. */
  holder?: CryptoKey | undefined;
  /** The account private key unlocked by the passphrase typed here (owner presence): approves this device itself when keys are required. */
  owner?: CryptoKey | undefined;
  log(detail: string): void;
}

export interface TrustResult {
  required: boolean;
  certs: Map<string, DeviceCert>;
  grants: Map<string, SpaceGrants>;
  proof: DeviceProof | undefined;
  signer: DeviceProof | undefined;
  /** Signed removals (#258). */
  removals: Removal[];
  /** The account key removed this device's own keys (#258): it stops syncing (S-258g). */
  removedSelf: boolean;
}

/**
 * Work out certificates, "keys required" and space keys from the account document (#256, #257), with
 * the writes this device makes on the way: certificates on first use (compatible mode, the key's
 * holder), its own approval (keys required, passphrase typed here), and space keys for spaces it keeps.
 * Shared by the app and the Obsidian plugin.
 */
export async function computeTrust(i: TrustInputs): Promise<TrustResult> {
  const { doc, fp, me, own } = i;
  // Read the account keys once for every check below; signature checks are remembered per record (`verifyText`).
  const accounts = await readAccountKeys(doc);
  const required = await keysRequired(doc, fp, accounts);
  // Removals signed by the account key (#258); with keys required they decide who is removed.
  const removals = required ? await readRemovals(doc, accounts.find((a) => a.fingerprint === fp)) : [];
  const removed = new Set(removals.map(removalTag));
  // With keys required only an owner's approval counts (#257), and only a signed removal removes (#258).
  let certs = await readCerts(doc, fp, accounts, required, removed);
  // Compatible mode: the holder of the account key certifies every device that published keys and has no certificate yet
  // (trust on first use, as the sync code already is). Once keys are required, only approval does that.
  if (fp && i.holder && !required) {
    let n = 0;
    for (const [id, rec] of readDeviceKeys(doc)) {
      if (certs.has(id) || isRemoved(doc, id) || isLeft(doc, id)) continue;
      await certifyDevice(doc, fp, i.holder, id, rec);
      n++;
    }
    if (n > 0) {
      i.log(`certified ${n} device(s)`);
      certs = await readCerts(doc, fp, accounts);
    }
  }
  // Keys required and the passphrase typed here, but no approval for this device's keys (restored on a fresh browser,
  // or its keys were lost): whoever has the passphrase is the owner, so the device approves itself.
  const removedSelf = required && !!own && removed.has(removalTag({ deviceId: me, key: await fingerprint(own.publicKeys.sign) }));
  if (fp && i.owner && required && own && !certMatches(certs.get(me), own.publicKeys) && !isLeft(doc, me) && !removedSelf) {
    await certifyDevice(doc, fp, i.owner, me, own.publicKeys, true);
    i.log('approved this device with the passphrase');
    certs = await readCerts(doc, fp, accounts, required, removed);
  }
  const proof = own && certMatches(certs.get(me), own.publicKeys) ? { sign: own.sign.privateKey, agree: own.agree.privateKey } : undefined;
  let grants = await readGrants(doc, fp, certs, accounts);
  if (proof) {
    const n = await maintainGrants(doc, { me, spaces: readSpaces(doc).map((sp) => sp.id), certs, grants, signKey: proof.sign, agreeKey: proof.agree });
    if (n > 0) grants = await readGrants(doc, fp, certs, accounts);
  }
  const signer = own ? { sign: own.sign.privateKey, agree: own.agree.privateKey } : undefined;
  return { required, certs, grants, proof, signer, removals, removedSelf };
}

/** Put a result into the trust the sync layer reads. True when anything that matters to sync changed. */
export function applyTrust(trust: KeyTrust, fp: string | undefined, r: TrustResult): boolean {
  const before = trust.summary();
  trust.accountFp = fp;
  trust.isRequired = r.required;
  trust.certs = r.certs;
  trust.grants = r.grants;
  trust.proof = r.proof;
  trust.signer = r.signer;
  trust.removedDevices = new Set(r.removals.map((x) => x.deviceId));
  return trust.summary() !== before;
}
