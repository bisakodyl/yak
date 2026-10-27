/**
 * Detects that the user was away: the page was hidden, or the device slept and the page stopped
 * ticking, for longer than a threshold. Pure logic; the caller feeds it events with timestamps.
 */
export const IDLE_THRESHOLD_MS = 10 * 60 * 1000;

export interface IdleGap {
  /** When the page was last seen active; the idle time starts here. */
  since: number;
  /** How long the page was away. */
  ms: number;
}

export class IdleTracker {
  private lastSeen: number;

  constructor(
    now: number,
    private readonly thresholdMs: number = IDLE_THRESHOLD_MS,
  ) {
    this.lastSeen = now;
  }

  /** Call about once a second while the page is visible. Catches sleep, where no event fires. */
  tick(now: number): IdleGap | null {
    return this.seen(now);
  }

  /** The page was hidden at `now`. */
  hide(now: number): void {
    this.lastSeen = now;
  }

  /** The page became visible at `now`. */
  show(now: number): IdleGap | null {
    return this.seen(now);
  }

  private seen(now: number): IdleGap | null {
    const ms = now - this.lastSeen;
    const gap = ms > this.thresholdMs ? { since: this.lastSeen, ms } : null;
    this.lastSeen = now;
    return gap;
  }
}
