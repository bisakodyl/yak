/** The part of a peer link the mesh drives; `PeerLink` implements it. */
export interface LinkEndpoint {
  createOffer(): Promise<{ code: string }>;
  acceptOffer(code: string): Promise<{ code: string }>;
  acceptAnswer(code: string): Promise<void>;
  send(data: Uint8Array): void;
  close(): void;
}

export type LinkState = 'stopped' | 'waiting-for-peer' | 'connecting' | 'connected' | 'reconnecting';
