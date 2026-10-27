import * as Y from 'yjs';
import { describe, expect, it } from 'vitest';
import { keysMap, publishAccountKey, publishDeviceKeys, sealAccountKey } from '../core/account-keys';
import { certifyDevice, checkApproval, requireKeys } from '../core/key-certs';
import { fingerprint, generateAccountKey, generateDeviceKeys, type PublicKeyJwk } from '../core/keys';
import { compareCode, InviteGuest, InviteHost, type Approval, type JoinRequest } from './invite';
import { generateSecret } from './pairing-secret';
import type { InboxMessage, SignalingTransport, SubscribeHandlers } from './signaling';
import { base64url } from '../core/bytes';
import { INVITE_ENVELOPE } from '../core/protocol-ids';

/** What anyone holding the code can send on the invite mailbox (the envelope of `invite.ts`). */
async function forge(code: string, net: SignalingTransport, m: Record<string, unknown>): Promise<void> {
  const { deriveInvite } = await import('./invite');
  const keys = await deriveInvite(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(INVITE_ENVELOPE + keys.topic) }, keys.key, new TextEncoder().encode(JSON.stringify(m))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  await net.publish(keys.topic, base64url(out));
}

/** An in-memory mailbox server: every subscriber of a topic gets every message, with server time. */
function memoryTransport(): SignalingTransport & { sent: string[] } {
  const subs = new Map<string, Set<SubscribeHandlers>>();
  let id = 0;
  const sent: string[] = [];
  return {
    sent,
    async publish(topic, message) {
      sent.push(topic);
      const m: InboxMessage = { id: String(++id), time: Date.now() / 1000, message };
      for (const h of subs.get(topic) ?? []) h.onMessage(m);
    },
    subscribe(topic, handlers) {
      const set = subs.get(topic) ?? new Set();
      subs.set(topic, set.add(handlers));
      return () => set.delete(handlers);
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 30));
/** Wait until `cond` holds (crypto under a loaded machine can take a while), at most 5 s. */
async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 250 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
}

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function account() {
  const k = await generateAccountKey();
  return { fingerprint: await fingerprint(k.publicKey), publicKey: k.publicKey };
}

function guestEvents() {
  const e = { seen: [] as string[], approved: undefined as Approval | undefined, declined: undefined as string | undefined, noAnswer: false };
  return {
    e,
    events: { onSeen: (_a: string, _k: PublicKeyJwk, c: string) => void e.seen.push(c), onApproved: (a: Approval) => void (e.approved = a), onDeclined: (w: string) => void (e.declined = w), onNoAnswer: () => void (e.noAnswer = true) },
  };
}

const approval = (fp: string): Approval => ({ accountId: fp.slice(0, 24), account: fp, records: [], secret: 'x', signalingUrl: 'wss://example/signal' });

describe('one-time invites (#257)', () => {
  it('both sides show the same 64-bit code, with a nonce chosen after the request; the approval waits for the person to confirm', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const acct = await account();
    const dev = await generateDeviceKeys();
    const request: JoinRequest = { deviceId: ID(1), name: 'Phone', ...dev.publicKeys, v: 3 };
    const requests: [string, string][] = [];
    const host = new InviteHost(code, net, acct, { onRequest: (r, c) => void requests.push([r.deviceId, c]) });
    await host.start();
    const g = guestEvents();
    const guest = new InviteGuest(code, net, request, g.events);
    await guest.start();
    await until(() => g.e.seen.length > 0);
    expect(requests.map(([id]) => id)).toEqual([ID(1)]);
    expect(g.e.seen).toEqual([requests[0]![1]]);
    expect(g.e.seen[0]).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    // The same request under another invite (another nonce) shows another code.
    const other = new InviteHost(generateSecret(), net, acct, { onRequest: () => undefined });
    expect(other.code).not.toBe(code);
    const { deriveInvite } = await import('./invite');
    const topic = (await deriveInvite(code)).topic;
    expect(await compareCode(topic, acct.fingerprint, 'another nonce', request)).not.toBe(g.e.seen[0]);
    // A second `seen` naming another account is ignored by the new device.
    const evil = await account();
    const evilHost = new InviteHost(code, net, evil, { onRequest: () => undefined });
    await evilHost.start();
    await guest.start();
    await tick();
    expect(g.e.seen).toHaveLength(1);
    // Approved before the person confirmed: held until then.
    await host.approve(ID(1), approval(acct.fingerprint));
    await tick();
    expect(g.e.approved).toBeUndefined();
    guest.confirm();
    expect(g.e.approved?.account).toBe(acct.fingerprint);
    for (const x of [host, evilHost, guest]) x.stop();
  });

  it('ignores a request whose device id is no UUID', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const requests: string[] = [];
    const host = new InviteHost(code, net, await account(), { onRequest: (r) => void requests.push(r.deviceId) });
    await host.start();
    const dev = await generateDeviceKeys();
    const g = guestEvents();
    const guest = new InviteGuest(code, net, { deviceId: 'chosen-id-to-grind-a-code', ...dev.publicKeys }, g.events);
    await guest.start();
    await tick();
    await tick();
    expect(requests).toEqual([]);
    host.stop();
    guest.stop();
  });

  it('admits one device: after the first approval every other request is declined as used', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const acct = await account();
    const requests: string[] = [];
    const used: string[][] = [];
    const host = new InviteHost(code, net, acct, { onRequest: (r) => void requests.push(r.deviceId), onUsed: (d) => void used.push(d) });
    await host.start();
    const mk = async (n: number) => {
      const g = guestEvents();
      const guest = new InviteGuest(code, net, { deviceId: ID(n), ...(await generateDeviceKeys()).publicKeys }, g.events);
      await guest.start();
      return { g, guest };
    };
    const first = await mk(1);
    const second = await mk(2);
    await until(() => requests.length === 2);
    first.guest.confirm();
    await until(() => first.g.e.seen.length > 0);
    first.guest.confirm();
    await host.approve(ID(1), approval(acct.fingerprint));
    await until(() => first.g.e.approved !== undefined && second.g.e.declined !== undefined);
    expect(second.g.e.declined).toBe('used');
    expect(used).toEqual([[ID(2)]]);
    // A device that asks only now is declined too.
    const late = await mk(3);
    await until(() => late.g.e.declined !== undefined);
    expect(late.g.e.declined).toBe('used');
    expect(host.used).toBe(true);
    for (const x of [host, first.guest, second.guest, late.guest]) x.stop();
  });

  it('stops asking when nobody answers (an account code in compatible mode)', async () => {
    const net = memoryTransport();
    const g = guestEvents();
    const guest = new InviteGuest(generateSecret(), net, { deviceId: ID(1), ...(await generateDeviceKeys()).publicKeys }, g.events, { resendMs: 20, noAnswerMs: 100 });
    await guest.start();
    await until(() => g.e.noAnswer);
    const sent = net.sent.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(g.e.noAnswer).toBe(true);
    expect(net.sent.length).toBe(sent);
    expect(sent).toBeLessThan(15);
  });

  it('another key opens nothing', async () => {
    const net = memoryTransport();
    const requests: JoinRequest[] = [];
    const host = new InviteHost(generateSecret(), net, await account(), { onRequest: (r) => void requests.push(r) });
    await host.start();
    const dev = await generateDeviceKeys();
    const guest = new InviteGuest(generateSecret(), net, { deviceId: ID(1), ...dev.publicKeys }, guestEvents().events);
    await guest.start();
    await tick();
    expect(requests).toEqual([]);
    host.stop();
    guest.stop();
  });
});

describe('checking an approval (#257)', () => {
  async function setup() {
    const doc = new Y.Doc();
    const a = await generateAccountKey();
    const fp = await fingerprint(a.publicKey);
    publishAccountKey(doc, fp, a.publicKey, 'owner', 0);
    await sealAccountKey(doc, fp, a.privateKey, 'correct horse battery', 100_000);
    const me = await generateDeviceKeys();
    publishDeviceKeys(doc, 'me', me.publicKeys);
    await requireKeys(doc, fp, a.privateKey, [{ deviceId: 'me', ...me.publicKeys }], 'me');
    return { doc, a, fp, me };
  }
  const records = (doc: Y.Doc, extra: [string, unknown][] = []): [string, unknown][] => [...Object.entries(keysMap(doc).toJSON()), ...extra];

  it('accepts an approved certificate for exactly these keys under the compared account key', async () => {
    const { doc, a, fp, me } = await setup();
    await certifyDevice(doc, fp, a.privateKey, 'me', me.publicKeys, true);
    const kept = await checkApproval(records(doc, [['spaces', 'no'], ['grant:x:1:me', {}]]), fp, 'me', me.publicKeys);
    expect(kept?.map(([k]) => k).sort()).toEqual(['account:' + fp, 'cert:me', 'chosen', 'device:me', 'required', 'sealed:' + fp].sort());
  });

  it('refuses a first-use certificate, another account key, or other keys', async () => {
    const { doc, a, fp, me } = await setup();
    await certifyDevice(doc, fp, a.privateKey, 'me', me.publicKeys);
    expect(await checkApproval(records(doc), fp, 'me', me.publicKeys)).toBeUndefined();
    await certifyDevice(doc, fp, a.privateKey, 'me', me.publicKeys, true);
    const other = await generateAccountKey();
    expect(await checkApproval(records(doc), await fingerprint(other.publicKey), 'me', me.publicKeys)).toBeUndefined();
    const mine = await generateDeviceKeys();
    expect(await checkApproval(records(doc), fp, 'me', mine.publicKeys as { sign: PublicKeyJwk; agree: PublicKeyJwk })).toBeUndefined();
  });

  it('a decline from someone else with the code, or before any seen, changes nothing (#291)', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const acct = await account();
    const dev = await generateDeviceKeys();
    const g = guestEvents();
    const guest = new InviteGuest(code, net, { deviceId: ID(1), ...dev.publicKeys, v: 3 }, g.events);
    await guest.start();
    // Before any `seen`: a decline with an account, or in the old shape without one.
    await forge(code, net, { t: 'declined', to: ID(1), account: acct.fingerprint, why: 'used' });
    await forge(code, net, { t: 'declined', to: ID(1), why: 'declined' });
    await tick();
    expect(g.e.declined).toBeUndefined();
    const host = new InviteHost(code, net, acct, { onRequest: () => undefined });
    await host.start();
    await until(() => g.e.seen.length > 0);
    // Another account's decline after the real `seen`.
    const evil = await account();
    await forge(code, net, { t: 'declined', to: ID(1), account: evil.fingerprint, why: 'declined' });
    await tick();
    expect(g.e.declined).toBeUndefined();
    guest.confirm();
    await host.approve(ID(1), approval(acct.fingerprint));
    await until(() => g.e.approved !== undefined);
    expect(g.e.approved?.account).toBe(acct.fingerprint);
    host.stop();
    guest.stop();
  });

  it('the compared account can decline', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const host = new InviteHost(code, net, await account(), { onRequest: () => undefined });
    await host.start();
    const g = guestEvents();
    const guest = new InviteGuest(code, net, { deviceId: ID(1), ...(await generateDeviceKeys()).publicKeys, v: 3 }, g.events);
    await guest.start();
    await until(() => g.e.seen.length > 0);
    await host.decline(ID(1));
    await until(() => g.e.declined !== undefined);
    expect(g.e.declined).toBe('declined');
    host.stop();
    guest.stop();
  });
});
