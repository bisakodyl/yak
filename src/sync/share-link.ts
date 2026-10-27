import { base64url } from '../core/bytes';
import { fingerprint, isPublicKeyJwk, type PublicKeyJwk } from '../core/keys';
import { SHARE_COMPARE_LABEL, SHARE_ENVELOPE, SHARE_KEY_INFO, SHARE_TOPIC_INFO } from '../core/protocol-ids';
import { deriveKeys, type DerivedKeys } from './pairing-secret';
import { compareDigest, freshness, isStr, MAILBOX_TTL_MS, openMessage, sealMessage } from './sealed-mailbox';
import type { SignalingTransport } from './signaling';

/**
 * A share link (#259, S-259): the one-time way another account joins a shared space. Built like an
 * invite (`invite.ts`), but between two accounts:
 *
 *   member device (B) ── ask (its account key, its approved certificates and removals) ──▶ owner device (A)
 *                     ◀── seen (the owner's key, a fresh nonce, the space name) ──
 *   both screens show `compareShareCode`; B's person confirms the match, the owner approves with the passphrase
 *                     ◀── approved (the roster records B needs) ──
 *
 * Messages are sealed with a key from the code in the link's fragment, so the relay sees nothing. The
 * code is over the owner's account key, the nonce A picks after the ask arrived, and B's account key,
 * so a swapped ask or a fake `seen` changes one screen. B follows an approval only after its person
 * confirmed and only from the owner it compared. A link admits one account; a decline is heeded only from
 * the owner that was compared (as S-291). The relay carries at most 8 KiB a message: bigger ones are refused here.
 */

export const SHARE_LINK_TTL_MS = MAILBOX_TTL_MS;
const RESEND_MS = 4000;
const SEEN_RESEND_MS = 10_000;
/** With no `seen` this long, nobody is listening on this link: stop asking. */
export const SHARE_NO_ANSWER_MS = 60_000;
/** The relay's message limit is 8 KiB; the sealed text must stay under it. */
export const SHARE_MESSAGE_LIMIT = 8000;

const DEVICE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FP = /^[a-f0-9]{32}$/;

export interface ShareAsk {
  /** The asking device. */
  deviceId: string;
  /** The name the asking person gave. */
  name?: string;
  /** Its account (fingerprint and key). */
  account: string;
  key: PublicKeyJwk;
  /** The account's approved certificates and signed removals, as in its account document (`cert:<id>`, `removal:<id>`). */
  records: [string, unknown][];
}

export interface ShareApprovalMessage {
  /** The owner's account fingerprint, as shown in `seen`. */
  account: string;
  space: string;
  spaceName: string;
  /** Roster records for the new member (`share`, `member:<fp>`, names, the owner's certificates). */
  records: [string, unknown][];
}

export type ShareDeclineReason = 'declined' | 'used';

type Message =
  | ({ t: 'ask' } & ShareAsk)
  | { t: 'seen'; to: string; account: string; publicKey: PublicKeyJwk; nonce: string; spaceName: string }
  | ({ t: 'approved'; to: string } & ShareApprovalMessage)
  | { t: 'declined'; to: string; account: string; why?: ShareDeclineReason };

export const deriveShareLink = (code: string): Promise<DerivedKeys> => deriveKeys(code, { topic: SHARE_TOPIC_INFO, key: SHARE_KEY_INFO });

/** What both screens show for one ask: the link, the owner's key, the owner's nonce, the asking account's key. */
export function compareShareCode(topic: string, ownerFp: string, nonce: string, ask: Pick<ShareAsk, 'account' | 'key'>): Promise<string> {
  return compareDigest(SHARE_COMPARE_LABEL, [topic, ownerFp, nonce, ask.account, ask.key.x, ask.key.y]);
}

const records = (v: unknown): v is [string, unknown][] => Array.isArray(v) && v.length <= 64 && v.every((r) => Array.isArray(r) && r.length === 2 && typeof r[0] === 'string' && r[0].length < 200);

async function seal(keys: DerivedKeys, m: Message): Promise<string> {
  const text = await sealMessage(keys, SHARE_ENVELOPE, m);
  if (text.length > SHARE_MESSAGE_LIMIT) throw new Error('Too many devices or records for one share link. Remove devices you no longer use, then try again.');
  return text;
}

/** Open a message and check its shape; undefined for anything else. An `ask` must carry a key that hashes to its account. */
async function unseal(keys: DerivedKeys, text: string): Promise<{ m: Message; nonce: string } | undefined> {
  const got = await openMessage(keys, SHARE_ENVELOPE, text, 12_000);
  if (!got) return undefined;
  const { m, nonce } = got;
  if (m.t === 'ask') {
    if (typeof m.deviceId !== 'string' || !DEVICE_ID.test(m.deviceId) || typeof m.account !== 'string' || !FP.test(m.account) || !isPublicKeyJwk(m.key) || !records(m.records)) return undefined;
    if (m.name !== undefined && (typeof m.name !== 'string' || m.name.length > 80)) return undefined;
    if ((await fingerprint(m.key)) !== m.account) return undefined;
    return { m: m as unknown as Message, nonce };
  }
  if (m.t === 'seen' && isStr(m.to) && isStr(m.account) && isPublicKeyJwk(m.publicKey) && isStr(m.nonce) && typeof m.spaceName === 'string' && m.spaceName.length < 200) return { m: m as unknown as Message, nonce };
  if (m.t === 'approved' && isStr(m.to) && isStr(m.account) && isStr(m.space) && typeof m.spaceName === 'string' && records(m.records)) return { m: m as unknown as Message, nonce };
  if (m.t === 'declined' && isStr(m.to) && isStr(m.account)) return { m: m as unknown as Message, nonce };
  return undefined;
}

export interface ShareHostEvents {
  /** An account asks, with the code both screens show (reported once per device and account key). */
  onRequest(ask: ShareAsk, compare: string): void;
  /** The link admitted an account: these other devices were declined. */
  onUsed?(declined: string[]): void;
}

interface HostRequest {
  ask: ShareAsk;
  seen: Message;
}

/** The owner's side: listens for asks while the link is open. */
export class ShareHost {
  private stops: (() => void)[] = [];
  private readonly requests = new Map<string, HostRequest>();
  private readonly answers = new Map<string, Message>();
  private keys: DerivedKeys | undefined;
  /** The link admitted an account; any other ask is declined. */
  used = false;
  readonly expiresAt = Date.now() + SHARE_LINK_TTL_MS;

  constructor(
    readonly code: string,
    private readonly transport: SignalingTransport,
    private readonly owner: { fingerprint: string; publicKey: PublicKeyJwk },
    private readonly spaceName: string,
    private readonly events: ShareHostEvents,
  ) {}

  async start(): Promise<void> {
    const keys = await deriveShareLink(this.code);
    this.keys = keys;
    const fresh = freshness();
    this.stops.push(
      this.transport.subscribe(keys.topic, {
        onMessage: (msg) =>
          void unseal(keys, msg.message).then(async (got) => {
            if (!got || got.m.t !== 'ask' || !fresh(msg, got.nonce)) return;
            const { t: _t, ...ask } = got.m;
            const answer = this.answers.get(ask.deviceId);
            if (answer) return void this.send(answer);
            if (this.used) {
              await this.send(this.seenFor(ask.deviceId, base64url(crypto.getRandomValues(new Uint8Array(16)))));
              return void this.send(this.declined(ask.deviceId, 'used'));
            }
            const known = this.requests.get(ask.deviceId);
            if (known && known.ask.account === ask.account) return void this.send(known.seen);
            // A fresh nonce for every ask, picked now: the code cannot be matched before it is shown.
            const nonce = base64url(crypto.getRandomValues(new Uint8Array(16)));
            const seen = this.seenFor(ask.deviceId, nonce);
            this.requests.set(ask.deviceId, { ask, seen });
            this.events.onRequest(ask, await compareShareCode(keys.topic, this.owner.fingerprint, nonce, ask));
            await this.send(seen);
          }),
      }),
    );
    const expire = setTimeout(() => this.stop(), SHARE_LINK_TTL_MS);
    this.stops.push(() => clearTimeout(expire));
  }

  /** Approve one asking device. The link is spent: every other ask is declined. */
  async approve(deviceId: string, approval: ShareApprovalMessage): Promise<void> {
    const m: Message = { t: 'approved', to: deviceId, ...approval };
    // Refuse an oversized answer before the link is spent.
    if (this.keys) await seal(this.keys, m);
    this.answers.set(deviceId, m);
    this.used = true;
    const others = [...this.requests.keys()].filter((id) => id !== deviceId && !this.answers.has(id));
    await this.send(m);
    for (const id of others) {
      const d = this.declined(id, 'used');
      this.answers.set(id, d);
      await this.send(d);
    }
    if (others.length) this.events.onUsed?.(others);
  }

  private seenFor(to: string, nonce: string): Message {
    return { t: 'seen', to, account: this.owner.fingerprint, publicKey: this.owner.publicKey, nonce, spaceName: this.spaceName };
  }

  private declined(to: string, why: ShareDeclineReason): Message {
    return { t: 'declined', to, account: this.owner.fingerprint, why };
  }

  decline(deviceId: string): Promise<void> {
    const m = this.declined(deviceId, 'declined');
    this.answers.set(deviceId, m);
    return this.send(m);
  }

  private async send(m: Message): Promise<void> {
    if (!this.keys) return;
    await this.transport.publish(this.keys.topic, await seal(this.keys, m));
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s();
  }
}

export interface ShareGuestEvents {
  /** The owner saw the ask: show the code and ask whether it matches. */
  onSeen(owner: string, key: PublicKeyJwk, spaceName: string, code: string): void;
  onApproved(a: ShareApprovalMessage): void;
  onDeclined(why: ShareDeclineReason): void;
  onNoAnswer?(): void;
  /** The ask could not be sent (too big for one message). */
  onFailed?(error: Error): void;
}

/** The asking account's side: sends its ask until answered. */
export class ShareGuest {
  private stops: (() => void)[] = [];
  private owner: string | undefined;
  private confirmed = false;
  private held: ShareApprovalMessage | undefined;
  private done = false;

  constructor(
    readonly code: string,
    private readonly transport: SignalingTransport,
    private readonly ask: ShareAsk,
    private readonly events: ShareGuestEvents,
    private readonly timing: { resendMs?: number; noAnswerMs?: number } = {},
  ) {}

  /** The person saw the same code on both screens: follow the approval (now, or when it arrives). */
  confirm(): void {
    if (!this.owner || this.done) return;
    this.confirmed = true;
    if (this.held) this.finish(this.held);
  }

  private finish(a: ShareApprovalMessage): void {
    this.done = true;
    this.stop();
    this.events.onApproved(a);
  }

  async start(): Promise<void> {
    const keys = await deriveShareLink(this.code);
    const fresh = freshness();
    const me = this.ask.deviceId;
    const startedAt = Date.now();
    let lastSent = 0;
    this.stops.push(
      this.transport.subscribe(keys.topic, {
        onMessage: (msg) =>
          void unseal(keys, msg.message).then(async (got) => {
            if (!got || this.done || got.m.t === 'ask' || got.m.to !== me || !fresh(msg, got.nonce)) return;
            const m = got.m;
            if (m.t === 'seen') {
              // The first owner seen is the one compared; its key must hash to the fingerprint it names.
              if (this.owner || (await fingerprint(m.publicKey)) !== m.account) return;
              this.owner = m.account;
              this.events.onSeen(m.account, m.publicKey, m.spaceName, await compareShareCode(keys.topic, m.account, m.nonce, this.ask));
            } else if (m.t === 'approved') {
              if (m.account !== this.owner) return;
              const { t: _t, to: _to, ...a } = m;
              if (this.confirmed) this.finish(a);
              else this.held = a;
            } else {
              if (!this.owner || m.account !== this.owner) return;
              this.done = true;
              this.stop();
              this.events.onDeclined(m.why === 'used' ? 'used' : 'declined');
            }
          }),
      }),
    );
    const send = async (): Promise<void> => {
      if (this.done) return;
      lastSent = Date.now();
      let text: string;
      try {
        text = await seal(keys, { t: 'ask', ...this.ask });
      } catch (e) {
        this.stop();
        this.done = true;
        this.events.onFailed?.(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      await this.transport.publish(keys.topic, text).catch(() => undefined);
    };
    void send();
    const timer = setInterval(() => {
      if (this.done) return;
      const now = Date.now();
      if (!this.owner) {
        if (now - startedAt > (this.timing.noAnswerMs ?? SHARE_NO_ANSWER_MS)) {
          this.stop();
          this.events.onNoAnswer?.();
          return;
        }
        void send();
      } else if (now - lastSent >= SEEN_RESEND_MS) void send();
    }, this.timing.resendMs ?? RESEND_MS);
    const expire = setTimeout(() => this.stop(), SHARE_LINK_TTL_MS);
    this.stops.push(() => clearInterval(timer), () => clearTimeout(expire));
  }

  stop(): void {
    for (const s of this.stops.splice(0)) s();
  }
}
