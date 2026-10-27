import { useEffect, useState } from 'preact/hooks';
import type { LicenseEntry } from '../licenses/collect';

type State = { kind: 'loading' } | { kind: 'ready'; entries: LicenseEntry[] } | { kind: 'missing' };

/** Help › Open source: the packages in this build with licence, author and link; each opens its licence text. */
export function OpenSource() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  useEffect(() => {
    let live = true;
    // Written at build time and saved for offline use with the rest of the app; a dev server has none.
    fetch(new URL('licenses.json', document.baseURI))
      .then((r) => (r.ok ? (r.json() as Promise<LicenseEntry[]>) : Promise.reject(new Error(String(r.status)))))
      .then((entries) => live && setState({ kind: 'ready', entries }))
      .catch(() => live && setState({ kind: 'missing' }));
    return () => {
      live = false;
    };
  }, []);
  if (state.kind === 'loading') return <p class="hint">Loading…</p>;
  if (state.kind === 'missing') return <p class="hint">The list is written when the app is built; it is not available in this session.</p>;
  return (
    <>
      <p>
        Yak is built on these open-source packages, each used under its own licence. All of them are included in this build.{' '}
        <a href="THIRD-PARTY-LICENSES.txt" target="_blank" rel="noopener noreferrer">
          All licence texts as one file
        </a>
        .
      </p>
      <ul class="oss-list">
        {state.entries.map((e) => (
          <li key={e.name}>
            <details>
              <summary>
                <strong>{e.name}</strong> <span class="muted">{e.version}</span> <span class="oss-license">{e.license}</span>
                {e.author ? <span class="muted"> · {e.author}</span> : null}
              </summary>
              {e.homepage ? (
                <p>
                  <a href={e.homepage} target="_blank" rel="noopener noreferrer">
                    {e.homepage}
                  </a>
                </p>
              ) : null}
              <pre class="oss-text" tabIndex={0}>{e.text.trim()}</pre>
              {e.notice.trim() ? <pre class="oss-text" tabIndex={0}>{e.notice.trim()}</pre> : null}
            </details>
          </li>
        ))}
      </ul>
    </>
  );
}
