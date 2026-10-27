import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryStore } from '../core/history/memory-store';
import { ENCRYPTION_FILE, InvalidParamsError, MAX_ITERATIONS, MIN_ITERATIONS, iterationsValid, EncryptedDir, EncryptedError, WrongPassphraseError, decryptBytes, encryptBytes, isEncrypted, keyFor, newEncryption, readFolderEncryption, withKey } from './crypto';
import { MemoryDir } from './dir';
import { stateAtTime } from './incremental';
import { BackupService, type StoredStatus } from './service';
import { addEntry, seedSpace } from './testing';

const FAST = MIN_ITERATIONS;
const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('passphrase and key', () => {
  it('encrypts and decrypts, and a wrong passphrase is refused before any file is read', async () => {
    const { params, key } = await newEncryption('correct horse', FAST);
    const sealed = await encryptBytes(key, bytes('secret'));
    expect(isEncrypted(sealed)).toBe(true);
    expect(new TextDecoder().decode(await decryptBytes(await keyFor('correct horse', params), sealed))).toBe('secret');
    await expect(keyFor('wrong horse', params)).rejects.toBeInstanceOf(WrongPassphraseError);
    const other = (await newEncryption('wrong horse', FAST)).key;
    await expect(decryptBytes(other, sealed)).rejects.toBeInstanceOf(WrongPassphraseError);
  });

  it('uses a fresh salt and IV every time', async () => {
    const a = await newEncryption('same', FAST);
    const b = await newEncryption('same', FAST);
    expect(a.params.salt).not.toBe(b.params.salt);
    const x = await encryptBytes(a.key, bytes('x'));
    expect(x).not.toEqual(await encryptBytes(a.key, bytes('x')));
  });

  it('an encrypted directory hides content, reads older plain files, and needs the key to read', async () => {
    const { key } = await newEncryption('pw', FAST);
    const raw = new MemoryDir();
    await raw.writeFile('plain.txt', bytes('old'));
    const dir = new EncryptedDir(raw, key);
    await dir.writeFile('a/b.txt', bytes('hello'));
    expect(new TextDecoder().decode(raw.files.get('a/b.txt'))).not.toContain('hello');
    expect(new TextDecoder().decode(await dir.readFile('a/b.txt'))).toBe('hello');
    expect(new TextDecoder().decode(await dir.readFile('plain.txt'))).toBe('old');
    await expect(withKey(raw, undefined).readFile('a/b.txt')).rejects.toBeInstanceOf(EncryptedError);
  });
});

describe('encrypted backups', () => {
  it('write no readable file, and restore to a time with the passphrase in a fresh profile', async () => {
    const { params, key } = await newEncryption('pw-1234', FAST);
    const root = new MemoryDir();
    const store = new MemoryStore();
    let saved: StoredStatus = { encrypted: true };
    const doc = new Y.Doc();
    seedSpace(doc, 'S');
    addEntry(doc, '2026-10-01T09:00:00Z', '2026-10-01T09:30:00Z', 'private thing');
    const service = new BackupService({
      docs: () => new Map([['space/a', doc]]),
      deviceId: 'dev00000',
      accountId: 'acct',
      history: store,
      keyring: async () => ({ key, params }),
      folder: { current: async () => ({ state: 'granted', id: 'f', name: 'B', dir: root }) },
      status: { load: () => saved, save: (s) => (saved = s) },
    });
    expect((await service.run('manual', { force: true })).status).toBe('written');

    const files = [...root.files.keys()];
    expect(files.some((f) => /\.(jsonl|md)$/.test(f) || /time_entries|notes\//.test(f))).toBe(false);
    for (const [path, data] of root.files) {
      if (path === `acct/${ENCRYPTION_FILE}`) continue;
      expect(isEncrypted(data), path).toBe(true);
      expect(new TextDecoder('latin1').decode(data)).not.toContain('private thing');
    }

    // A fresh profile only has the folder and the passphrase.
    const params2 = await readFolderEncryption(root, 'acct');
    expect(params2?.salt).toBe(params.salt);
    await expect(keyFor('nope', params2 as typeof params)).rejects.toBeInstanceOf(WrongPassphraseError);
    await expect(stateAtTime(withKey(root, undefined), 'acct', Date.now() + 1000)).rejects.toBeInstanceOf(EncryptedError);
    const view = withKey(root, await keyFor('pw-1234', params2 as typeof params));
    const { docs } = await stateAtTime(view, 'acct', Date.now() + 1000);
    const descriptions = Object.values(docs.get('space/a')?.getMap('time_entries').toJSON() ?? {}).map((e) => (e as { description: string }).description);
    expect(descriptions).toContain('private thing');
  });

  it('write nothing, and say why, when the device has no key', async () => {
    const root = new MemoryDir();
    let saved: StoredStatus = { encrypted: true };
    const service = new BackupService({
      docs: () => new Map([['space/a', new Y.Doc()]]),
      deviceId: 'dev00000',
      accountId: 'acct',
      keyring: async () => undefined,
      folder: { current: async () => ({ state: 'granted', id: 'f', name: 'B', dir: root }) },
      status: { load: () => saved, save: (s) => (saved = s) },
    });
    const r = await service.run('manual', { force: true });
    expect(r).toMatchObject({ status: 'failed' });
    expect(root.files.size).toBe(0);
  });
});

describe('iteration bounds', () => {
  it('accepts the range and rejects outside it in a production build', () => {
    expect(iterationsValid(MIN_ITERATIONS, false)).toBe(true);
    expect(iterationsValid(MAX_ITERATIONS, false)).toBe(true);
    for (const n of [1000, MIN_ITERATIONS - 1, MAX_ITERATIONS + 1, 1.5, NaN, Infinity]) expect(iterationsValid(n, false)).toBe(false);
  });

  it('lets a test build use small counts but still caps the top', () => {
    expect(iterationsValid(1000, true)).toBe(true);
    expect(iterationsValid(MAX_ITERATIONS + 1, true)).toBe(false);
  });

  it('refuses stored parameters outside the range without deriving', async () => {
    const { params } = await newEncryption('pass phrase', FAST);
    await expect(keyFor('pass phrase', { ...params, iterations: 1000 })).rejects.toBeInstanceOf(InvalidParamsError);
    await expect(keyFor('pass phrase', { ...params, iterations: 2_000_000_000 })).rejects.toBeInstanceOf(InvalidParamsError);
    await expect(newEncryption('x', 1000)).rejects.toBeInstanceOf(InvalidParamsError);
  });
});
