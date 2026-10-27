import { APP_NAME } from '../constants';

declare const __APP_VERSION__: string | undefined;

/** The About & help card on Settings: version, Help, what's new, licenses and Report a problem. */
export function AboutCard() {
  const version = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'development';
  return (
    <section class="card st-card" aria-labelledby="st-about-h">
      <h2 id="st-about-h">About &amp; help</h2>
      <p class="hint">
        {APP_NAME}, build {version}. Everything is stored on this device; sync is optional.
      </p>
      <ul class="st-links">
        <li>
          <a href="#/help">Help &amp; About</a>
        </li>
        <li>
          <a href="#/help/whats-new">What's new</a>
        </li>
        <li>
          <a href="#/help/open-source">Open source licenses</a>
        </li>
        <li>
          <a href="#/help/report">Report a problem</a>
        </li>
      </ul>
    </section>
  );
}
