import { keyTrust, ownerKeys } from './account-keys-runtime';

/**
 * The one passphrase prompt (F-324). An action that needs the account key goes through `withKey`;
 * when the key is not ready the passphrase sheet opens (create a passphrase, or enter it), and once
 * the key is ready the action runs by itself. The sheet's code loads when it is first needed.
 */

export interface KeyAction {
  /** What the action does, lowercase, finishing the sheet's button: "make a link" gives "Create and make a link" / "Unlock and make a link". */
  verb: string;
  /** Runs once the account key is ready. A throw is shown in the sheet, which stays open to try again. */
  run(): Promise<void>;
  /** False for an action that needs this device set up (a passphrase and device keys) but not the unlocked key, such as asking to join a share. */
  unlock?: boolean;
  /** Ask for the passphrase even when the account key is unlocked (to keep it on this device for backups, or to protect the account key). */
  fresh?: boolean;
}

export type KeyRequest =
  | { kind: 'key'; action: KeyAction; resolve(ran: boolean): void }
  /** The passphrase of a backup being restored: not the account's, so nothing is set or unlocked. */
  | { kind: 'backup'; verb: string; resolve(passphrase: string | undefined): void };

export interface KeyPromptDeps {
  me: string;
  /** Whether this device syncs with others: a device that does not has only itself to approve. */
  paired(): boolean;
}

class KeyPrompt {
  deps: KeyPromptDeps | undefined;
  current: KeyRequest | undefined;
  /** Goes up whenever the sheet finished something, so pages that show the passphrase state read it again. */
  version = 0;
  /** Counts the requests opened, so each gets a fresh sheet. */
  serial = 0;
  private readonly listeners = new Set<() => void>();

  configure(deps: KeyPromptDeps): void {
    this.deps = deps;
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(): void {
    for (const l of this.listeners) l();
  }

  open(req: KeyRequest): void {
    // One sheet at a time: a second request replaces an unanswered first one.
    this.close(false);
    this.current = req;
    this.serial++;
    this.emit();
  }

  /** Close the sheet; `ran` says whether the action ran. */
  close(ran: boolean): void {
    const req = this.current;
    if (!req) return;
    this.current = undefined;
    this.version++;
    if (req.kind === 'key') req.resolve(ran);
    else req.resolve(undefined);
    this.emit();
  }

  /** Whether the sheet must open before this action can run. */
  needed(action: KeyAction): boolean {
    if (action.fresh) return true;
    const setUp = keyTrust.required() && keyTrust.proof !== undefined;
    if (action.unlock === false) return !setUp;
    return !(setUp && ownerKeys.current.unlocked());
  }

  /** The account key is ready: a device that syncs with nothing else approves itself first (device keys, no pairing), then the action runs. */
  async finish(action: KeyAction): Promise<void> {
    const d = this.deps;
    if (d && !keyTrust.required() && !d.paired()) await ownerKeys.current.requireKeys([d.me]);
    await action.run();
  }
}

export const keyPrompt = new KeyPrompt();

/**
 * Run an action that needs the account key. Resolves true when it ran, false when the person closed
 * the sheet. A failure of the action rejects when no sheet was needed, else it is shown in the sheet.
 */
export async function withKey(action: KeyAction): Promise<boolean> {
  if (!keyPrompt.needed(action)) {
    await keyPrompt.finish(action);
    return true;
  }
  return new Promise<boolean>((resolve) => keyPrompt.open({ kind: 'key', action, resolve }));
}

/** Ask for the passphrase of a backup (restoring on a browser that does not hold the account's). Undefined when closed. */
export function askBackupPassphrase(verb: string): Promise<string | undefined> {
  return new Promise((resolve) => keyPrompt.open({ kind: 'backup', verb, resolve }));
}
