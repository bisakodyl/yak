import { useEffect, useState } from 'preact/hooks';
import { hasNewChanges, onChangesSeen } from './changes';
import { latestChange } from './topics';

/** The header's "?": opens Help; a dot says What's new has something this device has not seen. Hides below 20rem, with the timer's Continue chip. */
export function HelpButton() {
  const newest = latestChange();
  const [fresh, setFresh] = useState(() => hasNewChanges(newest));
  useEffect(() => onChangesSeen(() => setFresh(hasNewChanges(newest))), [newest]);
  return (
    <a class="help-btn" href={fresh ? '#/help/whats-new' : '#/help'} aria-label={fresh ? 'Help (something is new)' : 'Help'} title={fresh ? "Help: there is something new" : 'Help'}>
      ?{fresh ? <span class="help-dot" aria-hidden="true" /> : null}
    </a>
  );
}
