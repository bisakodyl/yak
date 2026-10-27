import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventLog } from './event-log';
import { PeerLink } from './peer-link';

afterEach(() => vi.unstubAllGlobals());

describe('PeerLink ICE servers', () => {
  it('hands the ICE servers to RTCPeerConnection', () => {
    const seen: RTCConfiguration[] = [];
    class FakePc {
      constructor(config: RTCConfiguration) {
        seen.push(config);
      }
      addEventListener(): void {}
    }
    vi.stubGlobal('RTCPeerConnection', FakePc);
    const events = { onOpen() {}, onMessage() {}, onClose() {}, onWaitTimeout() {} };
    new PeerLink(events, new EventLog(), [{ urls: 'stun:a:1' }]);
    expect(seen[0]?.iceServers).toEqual([{ urls: 'stun:a:1' }]);
  });
});
