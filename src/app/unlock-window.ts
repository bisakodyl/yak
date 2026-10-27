/** How long the account key stays unlocked in memory after its last use (F-324): each use starts the time again. */
export const UNLOCK_MS = 5 * 60_000;

/**
 * The unlocked account key and when it runs out. `peek` only looks (a background refresh must not
 * keep the key unlocked); `use` is for an action that signs with it and restarts the time.
 */
export class UnlockWindow {
  private held: { fp: string; key: CryptoKey; until: number } | undefined;

  constructor(
    private readonly now: () => number = Date.now,
    private readonly span = UNLOCK_MS,
  ) {}

  set(fp: string, key: CryptoKey): void {
    this.held = { fp, key, until: this.now() + this.span };
  }

  peek(fp: string): CryptoKey | undefined {
    const h = this.held;
    return h && h.fp === fp && h.until > this.now() ? h.key : undefined;
  }

  use(fp: string): CryptoKey | undefined {
    const key = this.peek(fp);
    if (key && this.held) this.held.until = this.now() + this.span;
    return key;
  }

  /** Milliseconds left for this account key (0: locked). */
  left(fp: string): number {
    const h = this.held;
    return h && h.fp === fp ? Math.max(0, h.until - this.now()) : 0;
  }
}
