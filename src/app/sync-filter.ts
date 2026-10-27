import type * as Y from 'yjs';
import { accountOfDoc, accountOfLogDoc } from '../core/account';
import { spaceDocId, spaceOfDoc } from '../core/doc-store';
import { keeps } from '../core/keeps';

export interface SyncFilterInput {
  docId: string;
  /** The device on the other end of the link. */
  peerId: string;
  /** This device's account document and id, and its own device id. */
  account: Y.Doc;
  accountId: string;
  me: string;
  /** This device has a sync code. */
  paired: boolean;
  /** The account the pairing belongs to; undefined while a device that joined has not learned it. */
  pairedAccountId: string | undefined;
  /** Device keys (#256). Absent or not `required`: compatible mode, the rules above as before. */
  keys?: {
    /** The account key signed "keys required". */
    required: boolean;
    /** The link to the peer is proven by its certified device key. */
    peerVerified: boolean;
    /** The peer holds the current key of this space. */
    peerHolds(spaceId: string): boolean;
  };
}

/**
 * May this document sync with this peer? The account document always does (that is how spaces are
 * chosen); a device that has just joined accepts the account document of whichever account it joined.
 * A space (and its private part) only between two devices that both keep it, and only once this
 * device's pairing is known to belong to this account.
 *
 * When the account requires keys, a peer without a proven device key gets nothing, and a space goes
 * only to a peer holding its key: `keeps` stays this device's choice, the key decides what it may have.
 */
export function allowsDoc(i: SyncFilterInput): boolean {
  if (i.keys?.required && !i.keys.peerVerified) return false;
  const paired = i.pairedAccountId !== undefined && i.pairedAccountId === i.accountId;
  const logOf = accountOfLogDoc(i.docId);
  if (logOf) return logOf === i.accountId && paired;
  const account = accountOfDoc(i.docId);
  if (account) return account === i.accountId || (i.paired && i.pairedAccountId === undefined);
  const space = spaceOfDoc(i.docId);
  if (space === undefined) return false;
  return paired && keeps(i.account, i.me, space) && keeps(i.account, i.peerId, space) && (!i.keys?.required || i.keys.peerHolds(space));
}

export interface ShareFilterInput {
  docId: string;
  /** The shared space this mesh belongs to. */
  space: string;
  /** The link to the peer is proven by a device key of an active member account, still valid now. */
  peerVerified: boolean;
}

/**
 * May this document sync with this peer on a share's mesh (#259, S-259)? Exactly the space's shared
 * document, to a verified peer. Never its private part, its log, an account document or another space.
 */
export function allowsShareDoc(i: ShareFilterInput): boolean {
  return i.peerVerified && i.docId === spaceDocId(i.space);
}

/**
 * May this space's files go to this peer on a share's mesh (#272)? Only files of the shared space, to
 * the same verified peers as its document. Direct links only, as for every file (file-transfer.ts).
 */
export function allowsShareFile(i: { unit: string; space: string; peerVerified: boolean }): boolean {
  return i.peerVerified && i.unit === i.space;
}
