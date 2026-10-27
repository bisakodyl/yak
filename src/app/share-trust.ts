import type { DeviceProof, PeerKeys, SyncIdentity } from '../sync/handshake';
import type { ShareState } from '../core/shares';

/**
 * What a share's mesh (#259) trusts, read synchronously by the sync layer. Worked out from the roster
 * (`readShare`) and this device's own proof; refreshed when either changes. The mesh requires proven
 * links: a peer is a device that an active member account other than this one certified.
 */
export class ShareTrust implements SyncIdentity {
  /** This device's account is an active member (the owner counts). */
  active = false;
  /** This device's proof in its own account, while it holds an approved certificate. */
  proof: DeviceProof | undefined;
  peers = new Map<string, PeerKeys>();
  /** Which member account vouches for each peer, for the panel. */
  accountOf = new Map<string, string>();

  /** This device's proof, only while its account is an active member. */
  own(): DeviceProof | undefined {
    return this.active ? this.proof : undefined;
  }

  peer(id: string): PeerKeys | undefined {
    return this.peers.get(id);
  }

  required(): boolean {
    return true;
  }

  /** Never connect to a device the roster does not vouch for (every device of this device's own account included: they sync on the account mesh). */
  blocked(id: string): boolean {
    return !this.peers.has(id);
  }

  /** A short summary: when it changes, the mesh works out pair keys and the filter again. */
  summary(): string {
    return JSON.stringify([this.active, !!this.proof, [...this.accountOf].sort()]);
  }
}

/** Put the roster and this device's proof into the trust. True when anything that matters to sync changed. */
export function applyShareTrust(trust: ShareTrust, ownFp: string | undefined, proof: DeviceProof | undefined, state: ShareState | undefined): boolean {
  const before = trust.summary();
  trust.active = !!state && !!ownFp && state.members.has(ownFp);
  trust.proof = proof;
  trust.peers = new Map();
  trust.accountOf = new Map();
  if (state && trust.active) {
    for (const [id, { fp, cert }] of state.devices) {
      if (fp === ownFp || !state.members.has(fp)) continue;
      trust.peers.set(id, { sign: cert.sign, agree: cert.agree });
      trust.accountOf.set(id, fp);
    }
  }
  return trust.summary() !== before;
}
