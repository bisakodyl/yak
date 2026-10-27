export interface MockNtfyMessage {
  id: string;
  time: number;
  event: string;
  topic: string;
  message: string;
}

export interface MockNtfy {
  url: string;
  state: { failPublish: boolean; publishes: number; subscribes: number; cacheDelayMs: number; rateLimitSubscribes: number };
  messages(topic: string): MockNtfyMessage[];
  dropStreams(): void;
  openStreams(): number;
  close(): Promise<void>;
}

export function startMockNtfy(options?: { port?: number; now?: () => number }): Promise<MockNtfy>;
