// The running/stopped cue outside the page: document title, favicon and app badge. Pure functions
// here; TimerCue.tsx applies them to the document.
import { type EntryRecord, isRunning, liveEntries, type TimeDocs } from './entries';
import { isoToMs } from './dates';
import { formatClock } from './format';

export const RUNNING_MARK = '▶';
export const STOPPED_MARK = '◼';
/** Longest description shown in the title; the taskbar shows only the start of it anyway. */
const TITLE_DESCRIPTION_MAX = 40;

export interface RunningCue {
  elapsedSeconds: number;
  description: string;
}

/** `H:MM` for a hidden page, whose timers the browser slows to about once a minute. */
export function formatElapsed(seconds: number, precision: 'seconds' | 'minutes'): string {
  if (precision === 'seconds') return formatClock(seconds);
  const minutes = Math.floor(Math.max(0, seconds) / 60);
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

function shorten(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The document title: elapsed time first, so it stays readable when the taskbar cuts it off.
 * Running: `▶ 0:12:34 Write report – App`; stopped: `◼ Not tracking – App`.
 */
export function cueTitle(running: RunningCue | null, appName: string, precision: 'seconds' | 'minutes' = 'seconds'): string {
  if (!running) return `${STOPPED_MARK} Not tracking – ${appName}`;
  const description = shorten(running.description, TITLE_DESCRIPTION_MAX);
  const head = `${RUNNING_MARK} ${formatElapsed(running.elapsedSeconds, precision)}`;
  return description ? `${head} ${description} – ${appName}` : `${head} – ${appName}`;
}

/** The parts of `navigator` the badge uses; both are optional (installed apps on Chrome and Edge only). */
export interface BadgeNavigator {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

export type BadgeResult = 'set' | 'cleared' | 'unsupported' | 'failed';

/**
 * A plain badge (a dot, no number) while running, none while stopped. Feature-detected; a refusal
 * (not installed, permission, policy) is ignored, because the title and favicon carry the cue too.
 */
export async function applyBadge(nav: BadgeNavigator | undefined, running: boolean): Promise<BadgeResult> {
  try {
    if (running) {
      if (typeof nav?.setAppBadge !== 'function') return 'unsupported';
      await nav.setAppBadge();
      return 'set';
    }
    if (typeof nav?.clearAppBadge === 'function') await nav.clearAppBadge();
    else if (typeof nav?.setAppBadge === 'function') await nav.setAppBadge(0);
    else return 'unsupported';
    return 'cleared';
  } catch {
    return 'failed';
  }
}

export interface LastEntry {
  spaceId: string;
  entry: EntryRecord;
}

/** The entry that stopped last, across every space, for "continue last entry". Ties by id. */
export function lastStopped(privateDocs: TimeDocs): LastEntry | undefined {
  let best: LastEntry | undefined;
  let bestStop = -Infinity;
  for (const [spaceId, doc] of privateDocs) {
    for (const entry of liveEntries(doc)) {
      if (isRunning(entry)) continue;
      const stop = isoToMs(entry.stop);
      if (Number.isNaN(stop)) continue;
      if (stop > bestStop || (stop === bestStop && best && entry.id > best.entry.id)) {
        best = { spaceId, entry };
        bestStop = stop;
      }
    }
  }
  return best;
}
