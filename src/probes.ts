import { detectBrowser } from './browser';
import { STORAGE_PREFIX } from './constants';
import { loadHandle, saveHandle } from './handles';
import { TOPIC_PREFIX } from './core/protocol-ids';

export type Status = 'ok' | 'warn' | 'fail' | 'info' | 'pending';

export interface ProbeResult {
  status: Status;
  summary: string;
  details?: Record<string, unknown>;
}

interface ProbeOptions {
  stunUrl: string;
  ntfyUrl: string;
}

export interface Probe {
  id: string;
  title: string;
  /** Why the app needs this. */
  why: string;
  /** Passive checks run on load. */
  run: () => Promise<ProbeResult>;
  /** Optional deeper test that may prompt the user or touch the network; run on click. */
  action?: { label: string; run: (opts: ProbeOptions) => Promise<ProbeResult> };
}

const errMsg = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

const withTimeout = <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });

async function queryPermission(h: FileSystemDirectoryHandle): Promise<string> {
  const q = (h as unknown as { queryPermission?: (d: object) => Promise<string> }).queryPermission;
  if (!q) return 'unsupported';
  try {
    return await q.call(h, { mode: 'readwrite' });
  } catch (e) {
    return errMsg(e);
  }
}

/** A fetch that fails with TypeError is a network, CSP or CORS block; the browser does not say which. */
async function reach(name: string, url: string) {
  const host = (() => {
    try {
      return new URL(url).host;
    } catch {
      return url;
    }
  })();
  const start = performance.now();
  try {
    const res = await withTimeout(fetch(url, { cache: 'no-store', credentials: 'omit' }), 8000, 'fetch');
    return { name, host, ok: res.ok, result: `HTTP ${res.status} in ${Math.round(performance.now() - start)} ms` };
  } catch (e) {
    const blocked = e instanceof TypeError ? ' (blocked: network, CSP or CORS)' : '';
    return { name, host, ok: false, result: `${errMsg(e)}${blocked}` };
  }
}

export interface RelayProbeOptions {
  /** `wss://host/signal`. Default: this site's own `/signal`. */
  baseUrl?: string;
  WebSocketImpl?: typeof WebSocket;
  timeoutMs?: number;
}

/**
 * Opens two sockets on a throwaway room of the signaling relay and checks that a message sent by
 * one reaches the other, then that `ping` is answered. Corporate proxies sometimes break
 * WebSockets while ordinary HTTPS works, so this is its own check. Sends only random bytes.
 */
export async function probeRelay(options: RelayProbeOptions = {}): Promise<ProbeResult> {
  const Impl = options.WebSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
  if (!Impl) return { status: 'fail', summary: 'WebSocket is not available in this browser' };
  const timeoutMs = options.timeoutMs ?? 8000;
  const base = (options.baseUrl ?? `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/signal`).replace(/\/+$/, '');
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const topic = `${TOPIC_PREFIX}${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  const url = `${base}/${topic}`;
  const nonce = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  const sockets: WebSocket[] = [];
  const started = performance.now();
  const elapsed = (): number => Math.round(performance.now() - started);

  /** Resolves with the first frame (as text) satisfying `want`, or rejects on error, close or timeout. */
  const frames = (socket: WebSocket) => {
    const waiting: { want: (text: string) => boolean; resolve: (text: string) => void }[] = [];
    const seen: string[] = [];
    let failure: Error | undefined;
    const failAll = (e: Error): void => {
      failure = e;
      for (const w of waiting.splice(0)) w.resolve('');
    };
    socket.onmessage = (event: MessageEvent) => {
      const text = typeof event.data === 'string' ? event.data : '';
      seen.push(text);
      for (const [i, w] of waiting.entries()) {
        if (w.want(text)) {
          waiting.splice(i, 1);
          w.resolve(text);
          return;
        }
      }
    };
    socket.onerror = () => failAll(new Error('connection error'));
    socket.onclose = (e: CloseEvent) => failAll(new Error(`closed (${e.code}${e.reason ? ' ' + e.reason : ''})`));
    return {
      next: (want: (text: string) => boolean, label: string): Promise<string> =>
        withTimeout(
          new Promise<string>((resolve, reject) => {
            const early = seen.find(want);
            if (early !== undefined) return resolve(early);
            if (failure) return reject(failure);
            waiting.push({ want, resolve: (text) => (failure && !text ? reject(failure) : resolve(text)) });
          }),
          timeoutMs,
          label,
        ),
    };
  };
  const opened = (socket: WebSocket): Promise<void> =>
    withTimeout(
      new Promise<void>((resolve, reject) => {
        socket.addEventListener('open', () => resolve(), { once: true });
        socket.addEventListener('error', () => reject(new Error('connection error')), { once: true });
      }),
      timeoutMs,
      'WebSocket connect',
    );

  try {
    const first = new Impl(url);
    sockets.push(first);
    const firstFrames = frames(first);
    await opened(first);
    const connectMs = elapsed();
    const hello = await firstFrames.next((t) => t.includes('"open"'), 'relay open event');
    let serverClockSkewSeconds: number | undefined;
    try {
      const time = (JSON.parse(hello) as { time?: unknown }).time;
      if (typeof time === 'number') serverClockSkewSeconds = Math.round(time - Date.now() / 1000);
    } catch {
      // Not JSON: the server is not our relay.
      return { status: 'fail', summary: `Connected, but the first frame was not the relay's open event: ${hello.slice(0, 60)}` };
    }

    const second = new Impl(url);
    sockets.push(second);
    await opened(second);
    const sendAt = performance.now();
    second.send(nonce);
    const relayed = await firstFrames.next((t) => t.includes(nonce), 'message from the second socket');
    const deliveryMs = Math.round(performance.now() - sendAt);
    let malformed = false;
    try {
      malformed = (JSON.parse(relayed) as { message?: unknown }).message !== nonce;
    } catch {
      malformed = true;
    }
    if (malformed) return { status: 'warn', summary: 'A message was relayed, but not in the expected format' };

    const pingAt = performance.now();
    first.send('ping');
    await firstFrames.next((t) => t === 'pong', 'pong');
    const pongMs = Math.round(performance.now() - pingAt);
    return {
      status: 'ok',
      summary: `Relay works: connected in ${connectMs} ms, delivered in ${deliveryMs} ms, ping answered in ${pongMs} ms`,
      details: { host: new URL(url).host, connectMs, deliveryMs, pongMs, serverClockSkewSeconds },
    };
  } catch (e) {
    const where = sockets.length === 0 ? '' : sockets.length === 1 ? ' (first socket)' : ' (second socket)';
    return {
      status: 'fail',
      summary: `${errMsg(e)}${where}. WebSockets may be blocked here by a proxy, a CSP rule or the network; ntfy remains usable.`,
      details: { host: (() => { try { return new URL(url).host; } catch { return url; } })() },
    };
  } finally {
    for (const socket of sockets) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      try {
        socket.close(1000, 'probe done');
      } catch {
        // Already closed.
      }
    }
  }
}

async function permissionState(name: string): Promise<string> {
  try {
    const s = await navigator.permissions.query({ name: name as PermissionName });
    return s.state;
  } catch {
    return 'unsupported';
  }
}

/** Classify an ICE candidate line without exposing real addresses in the report. */
export function classifyCandidate(line: string): 'host-mdns' | 'host-ip' | 'srflx' | 'relay' | 'other' {
  const type = /\btyp (\w+)/.exec(line)?.[1];
  const addr = line.split(' ')[4] ?? '';
  if (type === 'host') return addr.endsWith('.local') ? 'host-mdns' : 'host-ip';
  if (type === 'srflx') return 'srflx';
  if (type === 'relay') return 'relay';
  return 'other';
}

export type LoopbackResult = {
  outcome: 'ok' | 'not-delivered' | 'open-timeout' | 'error';
  error?: string;
  messageDelivered: boolean;
  /** Candidate kinds gathered by side A (host-mdns, host-ip, srflx, relay). */
  candidates: Record<string, number>;
  firstCandidateMs: number | null;
  offerSdpBytes: number;
  /** Final connection states of both peers, so a failure says where it stopped. */
  states: Record<string, string>;
  /** ICE candidate errors (for example an unreachable STUN server). */
  candidateErrors: string[];
  /** Ordered state changes with milliseconds since start. */
  timeline: string[];
};

/** Open two in-page peer connections and exchange a message over a data channel. Never throws. */
async function webrtcLoopback(iceServers: RTCIceServer[], openMs: number): Promise<LoopbackResult> {
  const a = new RTCPeerConnection({ iceServers });
  const b = new RTCPeerConnection({ iceServers });
  const counts: Record<string, number> = {};
  const timeline: string[] = [];
  const candidateErrors: string[] = [];
  const start = performance.now();
  const at = (): number => Math.round(performance.now() - start);
  let firstCandidateMs: number | null = null;

  for (const [name, pc] of [['a', a], ['b', b]] as const) {
    pc.addEventListener('icegatheringstatechange', () => timeline.push(`${at()}ms ${name} gathering ${pc.iceGatheringState}`));
    pc.addEventListener('iceconnectionstatechange', () => timeline.push(`${at()}ms ${name} ice ${pc.iceConnectionState}`));
    pc.addEventListener('connectionstatechange', () => timeline.push(`${at()}ms ${name} connection ${pc.connectionState}`));
    pc.addEventListener('icecandidateerror', (e) => {
      const ev = e as RTCPeerConnectionIceErrorEvent;
      candidateErrors.push(`${name} ${ev.errorCode} ${ev.errorText} ${ev.url}`.trim());
    });
  }
  a.onicecandidate = (e) => {
    if (e.candidate) {
      firstCandidateMs ??= at();
      const kind = classifyCandidate(e.candidate.candidate);
      counts[kind] = (counts[kind] ?? 0) + 1;
      void b.addIceCandidate(e.candidate).catch((err) => candidateErrors.push(`b addIceCandidate ${errMsg(err)}`));
    }
  };
  b.onicecandidate = (e) => {
    if (e.candidate) void a.addIceCandidate(e.candidate).catch((err) => candidateErrors.push(`a addIceCandidate ${errMsg(err)}`));
  };

  const finish = (outcome: LoopbackResult['outcome'], messageDelivered: boolean, error?: string): LoopbackResult => ({
    outcome,
    ...(error ? { error } : {}),
    messageDelivered,
    candidates: counts,
    firstCandidateMs,
    offerSdpBytes: a.localDescription?.sdp.length ?? 0,
    states: {
      aGathering: a.iceGatheringState,
      aIce: a.iceConnectionState,
      aConnection: a.connectionState,
      bGathering: b.iceGatheringState,
      bIce: b.iceConnectionState,
      bConnection: b.connectionState,
    },
    candidateErrors,
    timeline: timeline.slice(0, 40),
  });

  try {
    const channel = a.createDataChannel('probe');
    const received = new Promise<string>((resolve) => {
      b.ondatachannel = (ev) => {
        ev.channel.onmessage = (m) => resolve(String(m.data));
      };
    });
    const opened = new Promise<void>((resolve) => (channel.onopen = () => resolve()));
    const offer = await a.createOffer();
    await a.setLocalDescription(offer);
    await b.setRemoteDescription(offer);
    const answer = await b.createAnswer();
    await b.setLocalDescription(answer);
    await a.setRemoteDescription(answer);
    try {
      await withTimeout(opened, openMs, 'Data channel open');
    } catch (e) {
      return finish('open-timeout', false, errMsg(e));
    }
    channel.send('ping');
    let echoed = '';
    try {
      echoed = await withTimeout(received, 3000, 'Data channel message');
    } catch (e) {
      return finish('not-delivered', false, errMsg(e));
    }
    // Allow a little extra time for more candidates (e.g. STUN) to arrive.
    await new Promise((r) => setTimeout(r, 1500));
    return finish(echoed === 'ping' ? 'ok' : 'not-delivered', echoed === 'ping');
  } catch (e) {
    return finish('error', false, errMsg(e));
  } finally {
    a.close();
    b.close();
  }
}

/** Plain-language reading of a failed loopback, from what was gathered. */
export function explainLoopback(r: LoopbackResult): string {
  const total = Object.values(r.candidates).reduce((n, c) => n + c, 0);
  if (r.outcome === 'ok') return 'In-page data channel works';
  if (r.outcome === 'error') return `WebRTC error: ${r.error ?? 'unknown'}`;
  if (total === 0) {
    return 'No ICE candidates were gathered: WebRTC is likely restricted by browser policy (IP handling or UDP port range) or a security agent';
  }
  if (r.outcome === 'open-timeout') {
    return `Candidates were gathered (${JSON.stringify(r.candidates)}) but the connection never opened: local addresses could not be reached or resolved (mDNS .local names, or a local firewall blocking UDP)`;
  }
  return 'The channel opened but a test message was not delivered';
}

export const probes: Probe[] = [
  {
    id: 'browser',
    title: 'Browser and environment',
    why: 'Identify the browser and policy-relevant context.',
    run: async () => {
      const info = detectBrowser();
      const hints: Record<string, unknown> = {
        secureContext: window.isSecureContext,
        crossOriginIsolated: window.crossOriginIsolated,
        online: navigator.onLine,
        language: navigator.language,
        cookiesEnabled: navigator.cookieEnabled,
        webdriver: navigator.webdriver,
        cameraPermission: await permissionState('camera'),
        notificationPermission: await permissionState('notifications'),
      };
      return {
        status: window.isSecureContext ? 'info' : 'warn',
        summary: `${info.name} ${info.version} on ${info.platform}${window.isSecureContext ? '' : ' (NOT a secure context)'}`,
        details: { ...info, ...hints },
      };
    },
  },
  {
    id: 'webrtc',
    title: 'WebRTC data channel',
    why: 'Transport for peer-to-peer sync. If blocked, the device is backup-only.',
    run: async () => {
      if (typeof RTCPeerConnection === 'undefined') {
        return { status: 'fail', summary: 'RTCPeerConnection is not available (blocked or unsupported)' };
      }
      const r = await webrtcLoopback([], 5000);
      if (r.outcome === 'ok') {
        const mdns = (r.candidates['host-mdns'] ?? 0) > 0;
        return {
          status: 'ok',
          summary: `In-page data channel works${mdns ? '; LAN addresses hidden behind mDNS (.local)' : ''}`,
          details: r,
        };
      }
      return { status: 'fail', summary: explainLoopback(r), details: r };
    },
    action: {
      label: 'Test with STUN server',
      run: async ({ stunUrl }) => {
        const r = await webrtcLoopback([{ urls: stunUrl }], 8000);
        const srflx = (r.candidates['srflx'] ?? 0) > 0;
        if (r.outcome !== 'ok') return { status: 'fail', summary: explainLoopback(r), details: { stunUrl, ...r } };
        return {
          status: srflx ? 'ok' : 'warn',
          summary: srflx
            ? 'STUN reachable: server-reflexive candidate obtained'
            : 'No server-reflexive candidate: STUN is blocked or unreachable (see candidateErrors)',
          details: { stunUrl, ...r },
        };
      },
    },
  },
  {
    id: 'webrtc-camera',
    title: 'WebRTC with camera permission',
    why: 'Chrome shows real LAN addresses instead of .local names once camera access is granted. Tests whether the data channel works that way when it fails otherwise.',
    run: async () => ({ status: 'info', summary: 'Not tested. Press the button (asks camera permission).' }),
    action: {
      label: 'Test WebRTC with camera granted',
      run: async () => {
        if (!navigator.mediaDevices?.getUserMedia) return { status: 'fail', summary: 'getUserMedia is not available' };
        let stream: MediaStream | undefined;
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: true });
        } catch (e) {
          return { status: 'fail', summary: `Camera not available: ${errMsg(e)}` };
        }
        try {
          const r = await webrtcLoopback([], 5000);
          const raw = (r.candidates['host-ip'] ?? 0) > 0;
          return {
            status: r.outcome === 'ok' ? 'ok' : 'fail',
            summary:
              r.outcome === 'ok'
                ? `Works with camera granted; candidates: ${raw ? 'real LAN addresses' : 'still .local names'}`
                : explainLoopback(r),
            details: r,
          };
        } finally {
          stream.getTracks().forEach((t) => t.stop());
        }
      },
    },
  },
  {
    id: 'camera',
    title: 'Camera',
    why: 'QR pairing by webcam. If blocked, pair with a passphrase instead.',
    run: async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        return { status: 'fail', summary: 'getUserMedia is not available' };
      }
      const permission = await permissionState('camera');
      let cameras: number | string = 'unknown';
      try {
        cameras = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput').length;
      } catch (e) {
        cameras = errMsg(e);
      }
      const status: Status = permission === 'denied' || cameras === 0 ? 'fail' : 'warn';
      return {
        status,
        summary: `API present; permission: ${permission}; cameras: ${cameras}. Run the camera test to confirm.`,
        details: { permission, cameras },
      };
    },
    action: {
      label: 'Test camera (asks permission)',
      run: async () => {
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ video: true });
          const track = stream.getVideoTracks()[0];
          const settings = track?.getSettings() ?? {};
          stream.getTracks().forEach((t) => t.stop());
          return {
            status: 'ok',
            summary: `Camera stream opened (${settings.width ?? '?'}x${settings.height ?? '?'})`,
            details: { label: track?.label, width: settings.width, height: settings.height },
          };
        } catch (e) {
          return { status: 'fail', summary: errMsg(e) };
        }
      },
    },
  },
  {
    id: 'barcode',
    title: 'BarcodeDetector',
    why: 'Native QR scanning; otherwise a bundled JS decoder is needed.',
    run: async () => {
      const BD = (globalThis as { BarcodeDetector?: { getSupportedFormats(): Promise<string[]> } }).BarcodeDetector;
      if (!BD) return { status: 'warn', summary: 'Not available: a JS QR decoder fallback is required' };
      try {
        const formats = await BD.getSupportedFormats();
        const qr = formats.includes('qr_code');
        return {
          status: qr ? 'ok' : 'warn',
          summary: qr ? 'Available with qr_code support' : 'Available but qr_code is not supported',
          details: { formats },
        };
      } catch (e) {
        return { status: 'warn', summary: errMsg(e) };
      }
    },
  },
  {
    id: 'indexeddb',
    title: 'IndexedDB',
    why: 'Primary local store (via y-indexeddb).',
    run: async () => {
      if (typeof indexedDB === 'undefined') return { status: 'fail', summary: 'IndexedDB is not available' };
      const name = `${STORAGE_PREFIX}-probe-${Date.now()}`;
      try {
        const db = await new Promise<IDBDatabase>((resolve, reject) => {
          const req = indexedDB.open(name, 1);
          req.onupgradeneeded = () => req.result.createObjectStore('kv');
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
          req.onblocked = () => reject(new Error('open blocked'));
        });
        const value = await new Promise<unknown>((resolve, reject) => {
          const tx = db.transaction('kv', 'readwrite');
          tx.objectStore('kv').put('hello', 'k');
          const get = tx.objectStore('kv').get('k');
          tx.oncomplete = () => resolve(get.result);
          tx.onerror = () => reject(tx.error);
        });
        db.close();
        indexedDB.deleteDatabase(name);
        return value === 'hello'
          ? { status: 'ok', summary: 'Write and read round-trip succeeded' }
          : { status: 'fail', summary: 'Read back a different value than written' };
      } catch (e) {
        return { status: 'fail', summary: errMsg(e) };
      }
    },
  },
  {
    id: 'persistent-storage',
    title: 'Persistent storage',
    why: 'Makes browser eviction of local data unlikely.',
    run: async () => {
      if (!navigator.storage?.persisted) return { status: 'warn', summary: 'Storage API not available' };
      const persisted = await navigator.storage.persisted();
      const est = await navigator.storage.estimate?.().catch(() => undefined);
      return {
        status: persisted ? 'ok' : 'warn',
        summary: persisted ? 'Persistence already granted' : 'Not persistent yet. Request it to see if it is granted.',
        details: { persisted, usageBytes: est?.usage, quotaBytes: est?.quota },
      };
    },
    action: {
      label: 'Request persistence',
      run: async () => {
        if (!navigator.storage?.persist) return { status: 'fail', summary: 'persist() not available' };
        try {
          const granted = await navigator.storage.persist();
          return { status: granted ? 'ok' : 'warn', summary: granted ? 'Persistence granted' : 'Persistence denied' };
        } catch (e) {
          return { status: 'fail', summary: errMsg(e) };
        }
      },
    },
  },
  {
    id: 'file-system-access',
    title: 'File System Access',
    why: 'Backups to a picked folder and the Phase 2 vault mirror. Also checks whether folder permission survives a reload.',
    run: async () => {
      const w = window as unknown as Record<string, unknown>;
      const picker = typeof w.showDirectoryPicker === 'function';
      const opfs = typeof navigator.storage?.getDirectory === 'function';
      const details: Record<string, unknown> = { showDirectoryPicker: picker, originPrivateFileSystem: opfs };
      if (!picker) {
        return { status: 'fail', summary: 'showDirectoryPicker not available: no folder backups on this browser', details };
      }
      let stored: FileSystemDirectoryHandle | undefined;
      try {
        stored = await loadHandle();
      } catch (e) {
        details.storedHandleError = errMsg(e);
      }
      if (stored) {
        const state = await queryPermission(stored);
        details.storedHandle = { name: stored.name, permissionAfterReload: state };
        return {
          status: state === 'granted' ? 'ok' : 'warn',
          summary: `Saved folder "${stored.name}" found after reload; permission: ${state}.${
            state === 'granted' ? '' : ' The app would need to re-prompt on each visit.'
          }`,
          details,
        };
      }
      return {
        status: 'warn',
        summary: 'showDirectoryPicker present. Run the folder test, then reload this page to see if permission persists.',
        details,
      };
    },
    action: {
      label: 'Test folder write (pick a folder)',
      run: async () => {
        const w = window as unknown as {
          showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle>;
        };
        if (!w.showDirectoryPicker) return { status: 'fail', summary: 'showDirectoryPicker not available' };
        try {
          const dir = await w.showDirectoryPicker({ mode: 'readwrite' });
          const fileName = `${STORAGE_PREFIX}-probe-test.txt`;
          const fh = await dir.getFileHandle(fileName, { create: true });
          const writable = await fh.createWritable();
          await writable.write('probe');
          await writable.close();
          const text = await (await fh.getFile()).text();
          await dir.removeEntry(fileName);
          if (text !== 'probe') return { status: 'fail', summary: 'File contents did not match after write' };
          let saved = false;
          try {
            await saveHandle(dir);
            saved = true;
          } catch (e) {
            return {
              status: 'warn',
              summary: `Wrote, read and removed a test file in "${dir.name}", but the handle could not be stored: ${errMsg(e)}`,
            };
          }
          return {
            status: 'ok',
            summary: `Wrote, read and removed a test file in "${dir.name}". Handle saved (${saved}): reload to check permission persistence.`,
            details: { permissionNow: await queryPermission(dir) },
          };
        } catch (e) {
          return { status: 'fail', summary: errMsg(e) };
        }
      },
    },
  },
  {
    id: 'signaling',
    title: 'Signaling reachability',
    why: 'Automatic reconnect needs a mailbox: GitHub API or ntfy. Checks network and CORS only; no token or data is sent.',
    run: async () => ({
      status: 'info',
      summary: 'Not tested. Press the button to fetch api.github.com and the ntfy URL above.',
    }),
    action: {
      label: 'Test GitHub API and ntfy',
      run: async ({ ntfyUrl }) => {
        const targets = [
          { name: 'GitHub API', url: 'https://api.github.com/zen' },
          { name: 'ntfy', url: `${ntfyUrl.replace(/\/+$/, '')}/v1/health` },
        ];
        const outcomes = await Promise.all(targets.map((t) => reach(t.name, t.url)));
        const allOk = outcomes.every((o) => o.ok);
        return {
          status: allOk ? 'ok' : outcomes.some((o) => o.ok) ? 'warn' : 'fail',
          summary: outcomes.map((o) => `${o.name}: ${o.result}`).join('; '),
          details: { outcomes },
        };
      },
    },
  },
  {
    id: 'signaling-relay',
    title: 'Signaling relay (WebSocket)',
    why: 'An optional first-party signaling relay on this site needs WebSockets, which some corporate proxies break even when ordinary HTTPS works. Opens two sockets on a throwaway random room and sends 8 random bytes between them; nothing else is sent.',
    run: async () => ({
      status: 'info',
      summary: 'Not tested. Press the button to open a WebSocket to this site’s /signal path.',
    }),
    action: {
      label: 'Test the WebSocket relay',
      run: async () => probeRelay(),
    },
  },
  {
    id: 'service-worker',
    title: 'Service worker',
    why: 'Offline use once loaded.',
    run: async () => {
      if (!('serviceWorker' in navigator)) {
        return { status: 'fail', summary: 'Service workers are not available (insecure context or blocked)' };
      }
      try {
        // Narrow scope: the probe worker must never control the app's own pages.
        const scope = new URL('probe/', document.baseURI).pathname;
        const reg = await navigator.serviceWorker.register(new URL('probe-sw.js', document.baseURI).href, { scope });
        await reg.unregister();
        return { status: 'ok', summary: `Registered and unregistered a test worker (scope ${scope})` };
      } catch (e) {
        return { status: 'fail', summary: errMsg(e) };
      }
    },
  },
];
