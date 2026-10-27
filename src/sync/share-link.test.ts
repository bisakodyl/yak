import { describe, expect, it } from 'vitest';
import { base64url } from '../core/bytes';
import { fingerprint, generateAccountKey, type PublicKeyJwk } from '../core/keys';
import { SHARE_ENVELOPE } from '../core/protocol-ids';
import { generateSecret } from './pairing-secret';
import { compareShareCode, deriveShareLink, ShareGuest, ShareHost, type ShareApprovalMessage, type ShareAsk } from './share-link';
import type { InboxMessage, SignalingTransport, SubscribeHandlers } from './signaling';

function memoryTransport(): SignalingTransport {
  const subs = new Map<string, Set<SubscribeHandlers>>();
  let id = 0;
  return {
    async publish(topic, message) {
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

/** What anyone holding the link can send on its mailbox. */
async function forge(code: string, net: SignalingTransport, m: Record<string, unknown>): Promise<void> {
  const keys = await deriveShareLink(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(SHARE_ENVELOPE + keys.topic) }, keys.key, new TextEncoder().encode(JSON.stringify(m))));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  await net.publish(keys.topic, base64url(out));
}

async function until(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 250 && !cond(); i++) await new Promise((r) => setTimeout(r, 20));
}
const tick = () => new Promise((r) => setTimeout(r, 40));
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function account() {
  const k = await generateAccountKey();
  return { fingerprint: await fingerprint(k.publicKey), publicKey: k.publicKey };
}

const askFor = (a: { fingerprint: string; publicKey: PublicKeyJwk }, n = 1): ShareAsk => ({ deviceId: ID(n), name: 'B', account: a.fingerprint, key: a.publicKey, records: [] });
const approval = (owner: string): ShareApprovalMessage => ({ account: owner, space: 'a'.repeat(24), spaceName: 'Team', records: [] });

function guestEvents() {
  const e = { seen: [] as string[], approved: undefined as ShareApprovalMessage | undefined, declined: undefined as string | undefined };
  return {
    e,
    events: { onSeen: (_o: string, _k: PublicKeyJwk, _n: string, c: string) => void e.seen.push(c), onApproved: (a: ShareApprovalMessage) => void (e.approved = a), onDeclined: (w: string) => void (e.declined = w) },
  };
}

describe('share links (#259)', () => {
  it('both screens show the same code; the approval waits for the person to confirm', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const owner = await account();
    const b = await account();
    const shown: string[] = [];
    const host = new ShareHost(code, net, owner, 'Team', { onRequest: (_a, c) => void shown.push(c) });
    await host.start();
    const g = guestEvents();
    const guest = new ShareGuest(code, net, askFor(b), g.events);
    await guest.start();
    await until(() => g.e.seen.length > 0);
    expect(g.e.seen).toEqual(shown);
    expect(g.e.seen[0]).toMatch(/^[0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4} [0-9a-f]{4}$/);
    await host.approve(ID(1), approval(owner.fingerprint));
    await tick();
    expect(g.e.approved).toBeUndefined();
    guest.confirm();
    expect(g.e.approved?.space).toBe('a'.repeat(24));
    host.stop();
    guest.stop();
  });

  it('the code changes with each bound field', async () => {
    const owner = await account();
    const b = await account();
    const c = await account();
    const topic = (await deriveShareLink(generateSecret())).topic;
    const base = await compareShareCode(topic, owner.fingerprint, 'n', { account: b.fingerprint, key: b.publicKey });
    expect(await compareShareCode('other', owner.fingerprint, 'n', { account: b.fingerprint, key: b.publicKey })).not.toBe(base);
    expect(await compareShareCode(topic, c.fingerprint, 'n', { account: b.fingerprint, key: b.publicKey })).not.toBe(base);
    expect(await compareShareCode(topic, owner.fingerprint, 'm', { account: b.fingerprint, key: b.publicKey })).not.toBe(base);
    expect(await compareShareCode(topic, owner.fingerprint, 'n', { account: c.fingerprint, key: c.publicKey })).not.toBe(base);
  });

  it('refuses an ask whose key does not hash to its account', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const asked: string[] = [];
    const host = new ShareHost(code, net, await account(), 'Team', { onRequest: (a) => void asked.push(a.account) });
    await host.start();
    const b = await account();
    const c = await account();
    await forge(code, net, { t: 'ask', deviceId: ID(1), account: b.fingerprint, key: c.publicKey, records: [] });
    await tick();
    expect(asked).toEqual([]);
    host.stop();
  });

  it('ignores an approval from another owner than the one compared, and before a seen', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const owner = await account();
    const evil = await account();
    const host = new ShareHost(code, net, owner, 'Team', { onRequest: () => undefined });
    await host.start();
    const g = guestEvents();
    const guest = new ShareGuest(code, net, askFor(await account()), g.events);
    await forge(code, net, { t: 'approved', to: ID(1), ...approval(evil.fingerprint) });
    await guest.start();
    await until(() => g.e.seen.length > 0);
    guest.confirm();
    await forge(code, net, { t: 'approved', to: ID(1), ...approval(evil.fingerprint) });
    await tick();
    expect(g.e.approved).toBeUndefined();
    await host.approve(ID(1), approval(owner.fingerprint));
    await until(() => g.e.approved !== undefined);
    expect(g.e.approved?.account).toBe(owner.fingerprint);
    host.stop();
  });

  it('a seen from an owner whose key does not hash to its fingerprint is ignored', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const g = guestEvents();
    const guest = new ShareGuest(code, net, askFor(await account()), g.events);
    await guest.start();
    const owner = await account();
    const other = await account();
    await forge(code, net, { t: 'seen', to: ID(1), account: owner.fingerprint, publicKey: other.publicKey, nonce: 'x', spaceName: 'Team' });
    await tick();
    expect(g.e.seen).toEqual([]);
    guest.stop();
  });

  it('admits one account per link; a decline is heeded only from the owner compared', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const owner = await account();
    const requests: string[] = [];
    const host = new ShareHost(code, net, owner, 'Team', { onRequest: (a) => void requests.push(a.deviceId) });
    await host.start();
    const g1 = guestEvents();
    const g2 = guestEvents();
    const guest1 = new ShareGuest(code, net, askFor(await account(), 1), g1.events);
    const guest2 = new ShareGuest(code, net, askFor(await account(), 2), g2.events);
    await guest1.start();
    await guest2.start();
    await until(() => g1.e.seen.length > 0 && g2.e.seen.length > 0);
    // Someone else with the link sends a decline in the name of another account.
    const evil = await account();
    await forge(code, net, { t: 'declined', to: ID(1), account: evil.fingerprint, why: 'declined' });
    await tick();
    expect(g1.e.declined).toBeUndefined();
    await host.approve(ID(1), approval(owner.fingerprint));
    guest1.confirm();
    await until(() => g2.e.declined !== undefined);
    expect(g2.e.declined).toBe('used');
    expect(g1.e.approved).toBeDefined();
    // A third ask after the link was used.
    const g3 = guestEvents();
    const guest3 = new ShareGuest(code, net, askFor(await account(), 3), g3.events);
    await guest3.start();
    await until(() => g3.e.declined !== undefined);
    expect(g3.e.declined).toBe('used');
    for (const x of [host, guest1, guest2, guest3]) x.stop();
  });

  it('refuses an answer too big for one relay message before the link is spent', async () => {
    const net = memoryTransport();
    const code = generateSecret();
    const owner = await account();
    const host = new ShareHost(code, net, owner, 'Team', { onRequest: () => undefined });
    await host.start();
    const g = guestEvents();
    const guest = new ShareGuest(code, net, askFor(await account()), g.events);
    await guest.start();
    await until(() => g.e.seen.length > 0);
    await expect(host.approve(ID(1), { ...approval(owner.fingerprint), records: Array.from({ length: 40 }, (_, i) => [`cert:${i}`, { pad: 'x'.repeat(300) }] as [string, unknown]) })).rejects.toThrow(/Too many/);
    expect(host.used).toBe(false);
    host.stop();
    guest.stop();
  });
});
