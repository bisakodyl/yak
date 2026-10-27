import { useState } from 'preact/hooks';
import { logSharingOn, setLogSharing } from '../sync/log-sharing';

/** What the debug log holds; also in Help › Privacy (docs/user/privacy.md). */
const LOG_PRIVACY_TEXT =
  'connection and sync events, device names and network addresses; never the contents of notes or time entries. ' +
  'It is shared only between your own devices and kept 7 days.';

/** The switch in Devices › Logs: what the log holds, and a way to turn it off. */
export function LogSharingSwitch() {
  const [on, setOn] = useState(logSharingOn());
  return (
    <div>
      <label>
        <input
          type="checkbox"
          checked={on}
          onChange={(e) => {
            const v = (e.target as HTMLInputElement).checked;
            setLogSharing(v);
            setOn(v);
          }}
        />{' '}
        Share debug logs between my devices
      </label>
      <p class="hint">
        The log holds {LOG_PRIVACY_TEXT} Turning it off stops writing and clears this device's lines on all your devices.
      </p>
    </div>
  );
}
