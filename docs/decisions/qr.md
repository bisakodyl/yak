# QR code pairing decisions

| Decision | Why | How to change it |
| --- | --- | --- |
| Payload is `yak:pair?v=1&s=<secret, no dashes>[&sig=<url>]`. | Versioned, human-readable, and other QR codes (URLs, Wi-Fi) are rejected before anything is read from them. | `src/qr/payload.ts`; bump `v` and keep the parser strict. |
| `sig` is included only when the signaling server is not `https://ntfy.sh`. | Keeps the default code small and lets a self-hosted server travel with the secret. | `encodePairingPayload` in `src/qr/payload.ts`. |
| The scanned `sig` is accepted only as an http or https URL, and only fills the Signaling server field. | Nothing connects until the person presses Join, so a hostile code cannot silently redirect pairing. | `parsePairingPayload`; `onSignaling` in `src/devices/extras.tsx`. |
| The QR is drawn as Preact-rendered SVG (one path) instead of `createSvgTag` output through `innerHTML`. | No inline `style` attributes and no `innerHTML`, so the CSP (`style-src 'self'`) holds. | `src/qr/QrCode.tsx`, `src/qr/render.ts`. |
| Error correction level M, byte mode, 4-module quiet zone. | Good tolerance for screen glare while keeping the code about 45 modules wide for a 28-character secret. | `makeQr` in `src/qr/render.ts`. |
| Decode with `BarcodeDetector` when it supports `qr_code`, otherwise `jsqr`. | The probe showed `BarcodeDetector` is missing on Windows and Linux Chrome, so the JS decoder is the main path. | `createDecoder` in `src/qr/decode.ts`. |
| Scan at 8 frames per second on a canvas downscaled to at most 640 px. | Keeps `jsqr` well inside the main-thread budget. | `FPS` and `MAX_SIDE` in `src/qr/scanner.ts`. |
| Back camera preferred through `facingMode: { ideal: 'environment' }`. | Ideal, not exact, so laptops with one camera still work. | `startScan` in `src/qr/scanner.ts`. |
| Scanning fills in the secret field; it does not join by itself. After a scan the scanner shows "Code found" with a focused, scrolled-into-view primary **Join this account** button. | The person confirms the target and server before any signaling traffic; on a phone the typed-code Join row is off screen after a scan. | `onScanned` in `src/devices/extras.tsx`; `Scanner` in `src/qr/Scanner.tsx`. |
| The camera stops on success, cancel, error and unmount. | No stream is left running in the background. | `startScan` and `Scanner` cleanup. |
| The QR code is shown only for the secret just created, with a warning not to photograph or share it. | The code is the secret; it is no safer than the typed form. | `PairingExtras` in `src/devices/extras.tsx`. |
