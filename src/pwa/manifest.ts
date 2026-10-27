// The web app manifest that makes the site installable (Chrome, Edge, Firefox on Android).
// Built from APP_NAME at build time (src/offline/build-plugin.ts emits it as manifest.webmanifest).
export interface WebManifest {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: 'standalone';
  background_color: string;
  theme_color: string;
  launch_handler: { client_mode: 'focus-existing' };
  icons: { src: string; sizes: string; type: string; purpose: 'any' | 'maskable' }[];
}

const THEME_COLOR = '#1a7f37';
const BACKGROUND_COLOR = '#ffffff';

/** Relative URLs only: the app is served from the site root but never assumes it. */
export function buildWebManifest(appName: string): WebManifest {
  return {
    id: './',
    name: appName,
    short_name: appName,
    start_url: './',
    scope: './',
    display: 'standalone',
    background_color: BACKGROUND_COLOR,
    theme_color: THEME_COLOR,
    launch_handler: { client_mode: 'focus-existing' },
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
