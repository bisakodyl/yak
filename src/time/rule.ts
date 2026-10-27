import { compareRunning, findRunning, type RunningRef, type TimeDocs, startMs, stopEntryAt } from './entries';

/**
 * The running-timer rule: at most one running entry across all of a person's spaces.
 *
 * When more than one is running (sync brought in a second one), the one that started last stays
 * running and each older one is stopped at the start of the next later one, so the stopped
 * entries never overlap. Ties on the start time are broken by id. The result depends only on the
 * set of running entries, so every device that applies the rule reaches the same state, and
 * applying it again changes nothing. Returns the entries it stopped.
 */
export function enforceSingleRunning(privateDocs: TimeDocs): RunningRef[] {
  const running = findRunning(privateDocs).sort(compareRunning);
  const stopped: RunningRef[] = [];
  for (let i = 0; i < running.length - 1; i++) {
    const older = running[i];
    const newer = running[i + 1];
    if (!older || !newer) continue;
    const doc = privateDocs.get(older.spaceId);
    if (doc && stopEntryAt(doc, older.id, startMs(newer.entry))) stopped.push(older);
  }
  return stopped;
}
