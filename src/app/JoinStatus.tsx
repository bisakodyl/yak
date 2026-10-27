import { useEffect, useState } from 'preact/hooks';
import { confirmJoin, joinState, restartJoin, forgetJoinCode } from './join-state';
import { Button } from './ui';

/** What a joining device shows while it waits for approval (#257). */
export function JoinStatus() {
  const [, setTick] = useState(0);
  useEffect(() => joinState.subscribe(() => setTick((t) => t + 1)), []);
  const j = joinState.get();
  if (!j) return null;
  if (j.phase === 'compare')
    return (
      <div class="notice join-status" role="status" data-join="compare" data-confirmed={j.confirmed ? 'yes' : 'no'}>
        <p>
          Your other device shows a code for this one. It must be <code class="compare-code">{j.compare}</code>.
        </p>
        {j.confirmed ? (
          <p class="hint">Now approve this device on your other device.</p>
        ) : (
          <div class="row">
            <Button variant="primary" onClick={() => void confirmJoin()}>
              The codes match
            </Button>
            <Button onClick={() => void restartJoin()}>Codes don't match? Start again</Button>
          </div>
        )}
      </div>
    );
  if (j.phase === 'approved')
    return (
      <p class="notice join-status" role="status" data-join="approved">
        Approved. Joining…
      </p>
    );
  if (j.phase === 'declined')
    return (
      <div class="error join-status" role="status" data-join="declined">
        <p>{j.error ?? 'The other device declined this one.'}</p>
        <div class="row">
          {!j.used && <Button onClick={() => void restartJoin()}>Try again</Button>}
          <Button onClick={() => void forgetJoinCode()}>Use another code</Button>
        </div>
      </div>
    );
  if (j.phase === 'failed')
    return (
      <p class="error join-status" role="status" data-join="failed">
        {j.error}
      </p>
    );
  return null;
}
