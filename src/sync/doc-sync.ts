import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

/** Message-type prefix. Only the Yjs sync protocol is carried for now. */
const MESSAGE_SYNC = 0;

/**
 * Runs the standard Yjs sync protocol (y-protocols) for one document over any ordered,
 * reliable message channel, such as a WebRTC data channel. No merge logic lives here:
 * the transport only moves opaque Yjs messages.
 *
 * One instance serves one peer link. Updates received from a peer are not echoed back to
 * that peer, but are forwarded to other links on the same document, so a device can relay.
 */
export class DocSync {
  private closed = false;
  private peerVector: Map<number, number> | undefined;
  private readonly onUpdate = (update: Uint8Array, origin: unknown): void => {
    if (this.closed || origin === this) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeUpdate(encoder, update);
    this.send(encoding.toUint8Array(encoder));
  };

  constructor(
    private readonly doc: Y.Doc,
    private readonly send: (message: Uint8Array) => void,
    private readonly onError: (error: unknown) => void = () => undefined,
  ) {
    doc.on('update', this.onUpdate);
  }

  /**
   * Send our state vector; the peer replies with what we are missing. Safe to repeat: calling it
   * again later re-runs the exchange, which repairs any update lost on the way.
   */
  start(): void {
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MESSAGE_SYNC);
    syncProtocol.writeSyncStep1(encoder, this.doc);
    this.send(encoding.toUint8Array(encoder));
  }

  /**
   * How many Yjs operations this document has that the peer's last announced state lacks, or
   * undefined before the peer announced one. Counts operations (a typed character is one), not
   * user actions: a size, not an exact number of edits.
   */
  missingOnPeer(): number | undefined {
    const peer = this.peerVector;
    if (!peer) return undefined;
    let missing = 0;
    for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(this.doc))) missing += Math.max(0, clock - (peer.get(client) ?? 0));
    return missing;
  }

  receive(message: Uint8Array): void {
    if (this.closed) return;
    try {
      this.noteAnnouncedState(message);
      const decoder = decoding.createDecoder(message);
      const type = decoding.readVarUint(decoder);
      if (type !== MESSAGE_SYNC) return;
      const reply = encoding.createEncoder();
      encoding.writeVarUint(reply, MESSAGE_SYNC);
      syncProtocol.readSyncMessage(decoder, reply, this.doc, this);
      // A reply holds more than the type prefix only when the peer asked for something.
      if (encoding.length(reply) > 1) this.send(encoding.toUint8Array(reply));
    } catch (error) {
      // A malformed message must not break the link; the periodic re-sync repairs any gap.
      this.onError(error);
    }
  }

  /** Remember the state vector of a sync step 1 (the peer says what it has). */
  private noteAnnouncedState(message: Uint8Array): void {
    const peek = decoding.createDecoder(message);
    if (decoding.readVarUint(peek) !== MESSAGE_SYNC || decoding.readVarUint(peek) !== syncProtocol.messageYjsSyncStep1) return;
    this.peerVector = Y.decodeStateVector(decoding.readVarUint8Array(peek));
  }

  close(): void {
    this.closed = true;
    this.doc.off('update', this.onUpdate);
  }
}
