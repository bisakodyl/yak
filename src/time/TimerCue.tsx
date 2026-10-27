import { useEffect } from 'preact/hooks';
import { APP_NAME } from '../constants';
import { applyBadge, type BadgeNavigator, cueTitle } from './cue';
import { startMs } from './entries';
import { useRunning } from './hooks';
import runningIcon from './icons/timer-running.svg?url';
import stoppedIcon from './icons/timer-stopped.svg?url';

const ICON_ID = 'app-timer-icon';

function setFavicon(href: string): void {
  let link = document.getElementById(ICON_ID) as HTMLLinkElement | null;
  if (!link) {
    link = document.createElement('link');
    link.id = ICON_ID;
    link.rel = 'icon';
    link.type = 'image/svg+xml';
    document.head.append(link);
  }
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
}

/**
 * Always mounted (a global): shows whether a timer runs outside the page, for a minimised window
 * or a background tab. The title starts with the elapsed time, the favicon switches, and an
 * installed app gets a badge. Renders nothing.
 */
export function TimerCue() {
  const running = useRunning();
  const current = running[running.length - 1];
  const since = current ? startMs(current.entry) : null;
  const description = current?.entry.description ?? '';
  const isRunning = since !== null;

  useEffect(() => {
    setFavicon(isRunning ? runningIcon : stoppedIcon);
    void applyBadge(navigator as BadgeNavigator, isRunning);
  }, [isRunning]);

  useEffect(() => {
    const update = (): void => {
      const precision = document.visibilityState === 'hidden' ? 'minutes' : 'seconds';
      document.title = cueTitle(since === null ? null : { elapsedSeconds: (Date.now() - since) / 1000, description }, APP_NAME, precision);
    };
    update();
    if (since === null) return undefined;
    const tick = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => {
      clearInterval(tick);
      document.removeEventListener('visibilitychange', update);
    };
  }, [since, description]);

  return null;
}
