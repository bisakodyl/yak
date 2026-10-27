// The few service-worker globals the workers use. The project compiles against the DOM library;
// adding the WebWorker library would clash with it, so the shapes are declared here.

export interface SwExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}

export interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(r: Response | Promise<Response>): void;
}

export interface SwMessageEvent extends SwExtendableEvent {
  readonly data: unknown;
  readonly ports: readonly MessagePort[];
}

export interface SwWindowClient {
  readonly url: string;
  navigate(url: string): Promise<unknown>;
}

export interface SwGlobal {
  readonly registration: { readonly scope: string; unregister(): Promise<boolean> };
  readonly clients: {
    claim(): Promise<void>;
    matchAll(options?: { type?: 'window' | 'all'; includeUncontrolled?: boolean }): Promise<SwWindowClient[]>;
  };
  skipWaiting(): Promise<void>;
  addEventListener(type: 'install' | 'activate', fn: (e: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', fn: (e: SwFetchEvent) => void): void;
  addEventListener(type: 'message', fn: (e: SwMessageEvent) => void): void;
}
