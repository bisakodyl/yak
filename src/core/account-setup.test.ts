import { describe, expect, it } from 'vitest';
import { CURRENT_ACCOUNT_KEY, readSpaces } from './account';
import { accountIdFromSecret, ensureDefaultSpaces, prepareAccount, type StorageLike } from './account-setup';
import { DocumentStore } from './doc-store';

const memory = () => ({ whenLoaded: Promise.resolve(), destroy: () => Promise.resolve() });
const storage = (): StorageLike & { map: Map<string, string> } => {
  const map = new Map<string, string>();
  return { map, getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};
const SECRET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ23';

describe('account setup', () => {
  it('paired devices derive the same account id from the sync code, once', async () => {
    const sa = storage();
    const sb = storage();
    const pa = await prepareAccount(new DocumentStore(memory), { pairedSecret: SECRET, storage: sa });
    const pb = await prepareAccount(new DocumentStore(memory), { pairedSecret: SECRET, storage: sb });
    expect(pa.id).toBe(await accountIdFromSecret(SECRET));
    expect(pb.id).toBe(pa.id);
    expect(pa.derived && pb.derived).toBe(true);
    // A later start keeps the stored account and derives nothing.
    const again = await prepareAccount(new DocumentStore(memory), { pairedSecret: SECRET, storage: sa });
    expect(again.id).toBe(pa.id);
    expect(again.derived).toBe(false);
    expect(sa.map.get(CURRENT_ACCOUNT_KEY)).toBe(pa.id);
  });

  it('a fresh unpaired device gets a random account and no spaces until it creates the default ones', async () => {
    const store = new DocumentStore(memory);
    const p = await prepareAccount(store, { storage: storage() });
    expect(p.derived).toBe(false);
    expect(readSpaces(p.doc)).toEqual([]);
    expect([...store.opened().keys()]).toEqual([`account/${p.id}`]);
    ensureDefaultSpaces(p.doc);
    expect(readSpaces(p.doc).map((x) => x.name)).toEqual(['Personal', 'Work']);
    // Random ids, so two fresh accounts never share a space by accident.
    const other = await prepareAccount(new DocumentStore(memory), { storage: storage() });
    ensureDefaultSpaces(other.doc);
    expect(readSpaces(other.doc)[0]!.id).not.toBe(readSpaces(p.doc)[0]!.id);
  });

  it('does not add default spaces to an account that has some', async () => {
    const p = await prepareAccount(new DocumentStore(memory), { storage: storage() });
    ensureDefaultSpaces(p.doc);
    const before = readSpaces(p.doc).map((s) => s.id);
    ensureDefaultSpaces(p.doc);
    expect(readSpaces(p.doc).map((s) => s.id)).toEqual(before);
  });

  it('a new account takes the fingerprint of its key as id and publishes the key; a paired device still derives its id', async () => {
    const { generateAccountKey, fingerprint } = await import('./keys');
    const { publishAccountKey, winningAccountKey } = await import('./account-keys');
    const pair = await generateAccountKey();
    const fp = await fingerprint(pair.publicKey);
    const newKey = async () => ({ accountId: fp.slice(0, 24), publish: (d: import('yjs').Doc) => publishAccountKey(d, fp, pair.publicKey, 'dev') });
    const s = storage();
    const made = await prepareAccount(new DocumentStore(memory), { storage: s, newKey });
    expect(made.id).toBe(fp.slice(0, 24));
    expect((await winningAccountKey(made.doc))?.fingerprint).toBe(fp);
    const joiner = await prepareAccount(new DocumentStore(memory), { pairedSecret: SECRET, storage: storage(), newKey });
    expect(joiner.id).toBe(await accountIdFromSecret(SECRET));
    expect(await winningAccountKey(joiner.doc)).toBeUndefined();
  });
});
