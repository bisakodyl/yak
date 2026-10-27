import { useEffect, useState } from 'preact/hooks';
import { withKey } from '../key-prompt';
import { forgetShare } from '../pending-share';
import { safeStorage } from '../join';
import { shareCodeOf, shareLinks } from '../share-links';
import { Button } from '../ui';
import { useShares } from '../use-shares';

/**
 * Opening a share link (#259): `#/share/<code>`. The account must require device keys and this device
 * must be approved in it. The person compares a code with the owner's screen over a call and confirms.
 */
export function ShareJoin(props: { code: string }) {
  useShares();
  const code = shareCodeOf(`#/share/${props.code}`);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    try {
      setName(shareLinks.displayName());
    } catch {
      // Not configured yet.
    }
  }, []);
  const join = shareLinks.join;
  useEffect(() => {
    if (join?.phase === 'done') forgetShare(safeStorage());
  }, [join?.phase]);
  return (
    <section class="share-join" aria-label="Join a shared space" data-share-join={join?.phase ?? 'start'}>
      <h2>Join a shared space</h2>
      {!code ? (
        <p class="error" role="alert">
          This share link is not valid. Ask for a new one.
        </p>
      ) : !join ? (
        <>
          <p class="hint">Someone shared a space with you. You each keep your own devices and data; only that space is shared. Your name is shown to them.</p>
          <label>
            Your name{' '}
            <input type="text" aria-label="Your name" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} />
          </label>
          <div class="row">
            <Button
              variant="primary"
              onClick={() => {
                setError('');
                // A device not set up yet gets the passphrase sheet first; the link is remembered meanwhile.
                void withKey({ verb: 'ask to join', unlock: false, run: () => shareLinks.ask(code, name) }).catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              }}
            >
              Ask to join
            </Button>
          </div>
        </>
      ) : join.phase === 'asking' ? (
        <p class="hint" role="status">
          Waiting for the owner to open the same link on their device…
        </p>
      ) : join.phase === 'compare' ? (
        <>
          <p>
            You are asking to join <strong>{join.spaceName}</strong>. Compare this code with the one on the owner's screen, over a call or another channel than the one that carried the link:
          </p>
          <p>
            <code class="compare-code" data-compare>
              {join.compare}
            </code>
          </p>
          {join.confirmed ? (
            <p class="hint" role="status">
              Waiting for the owner to approve…
            </p>
          ) : (
            <div class="row">
              <Button variant="primary" onClick={() => shareLinks.confirm()}>
                The codes match
              </Button>
              <Button onClick={() => shareLinks.cancel()}>They differ</Button>
            </div>
          )}
        </>
      ) : join.phase === 'adding' ? (
        <p class="hint" role="status">
          Adding the space…
        </p>
      ) : join.phase === 'done' ? (
        <p role="status" data-share-done>
          Added <strong>{join.spaceName}</strong>. It is in your space list now. <a href="#/notes">Open Notes</a>
        </p>
      ) : (
        <>
          <p class="error" role="alert">
            {join.phase === 'declined' ? (join.error ?? 'The owner declined.') : (join.error ?? 'Something went wrong.')}
          </p>
          <div class="row">
            <Button onClick={() => shareLinks.cancel()}>Start again</Button>
          </div>
        </>
      )}
      {error ? (
        <p class="error" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
