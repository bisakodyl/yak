declare const __TEST_BUILD__: boolean;

/**
 * True only in a build made for the browser tests (`YAK_TEST_BUILD=1`, set by `npm run e2e`).
 * The production bundle then contains none of the `?test` hooks and ignores the `?test` URL flag.
 */
export const TEST_BUILD: boolean = typeof __TEST_BUILD__ !== 'undefined' && __TEST_BUILD__;

/** `?test` in the URL, honoured only in a test build. */
export function testMode(): boolean {
  return TEST_BUILD && typeof location !== 'undefined' && new URLSearchParams(location.search).has('test');
}
