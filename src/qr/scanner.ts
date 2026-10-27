import { createDecoder } from './decode';
import { parsePairingPayload, type PairingPayload } from './payload';

const FPS = 8;
const MAX_SIDE = 640;

export type ScanFailure = 'unsupported' | 'denied' | 'no-camera' | 'error';

export class ScanError extends Error {
  constructor(readonly kind: ScanFailure, message: string) {
    super(message);
  }
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function explainCameraError(e: unknown): ScanError {
  const name = e instanceof DOMException ? e.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return new ScanError('denied', 'Camera access was refused. Allow the camera for this site in the browser, or type the secret instead.');
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return new ScanError('no-camera', 'No camera was found on this device. Type the secret instead.');
  if (name === 'NotReadableError') return new ScanError('error', 'The camera is in use by another app.');
  return new ScanError('error', `Could not start the camera${e instanceof Error && e.message ? `: ${e.message}` : ''}`);
}

export interface ScanHandle {
  stop(): void;
}

/**
 * Open the camera in `video`, decode frames at about 8 per second on a downscaled canvas and call
 * `onPayload` once with the first valid Yak pairing code. Other QR codes are ignored
 * (reported through `onIgnored`) and scanning continues. Rejects with ScanError if the camera cannot start.
 */
export async function startScan(
  video: HTMLVideoElement,
  opts: { onPayload(p: PairingPayload): void; onIgnored?(message: string): void },
): Promise<ScanHandle> {
  if (!cameraSupported()) throw new ScanError('unsupported', 'This browser cannot open the camera here. Type the secret instead.');
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
  } catch (e) {
    throw explainCameraError(e);
  }
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = (): void => {
    stopped = true;
    if (timer) clearTimeout(timer);
    for (const track of stream.getTracks()) track.stop();
    video.srcObject = null;
  };
  try {
    video.srcObject = stream;
    video.muted = true;
    video.setAttribute('playsinline', '');
    await video.play();
  } catch (e) {
    stop();
    throw explainCameraError(e);
  }
  const canvas = document.createElement('canvas');
  const decode = await createDecoder(canvas);
  const tick = async (): Promise<void> => {
    if (stopped) return;
    const started = performance.now();
    if (video.videoWidth > 0) {
      const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d', { willReadFrequently: true })?.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const text = await decode();
        if (text && !stopped) {
          try {
            const payload = parsePairingPayload(text);
            stop();
            opts.onPayload(payload);
            return;
          } catch (e) {
            opts.onIgnored?.(e instanceof Error ? e.message : String(e));
          }
        }
      } catch {
        // a bad frame is not fatal
      }
    }
    if (!stopped) timer = setTimeout(() => void tick(), Math.max(0, 1000 / FPS - (performance.now() - started)));
  };
  void tick();
  return { stop };
}
