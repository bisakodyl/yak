import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { allowsDoc } from '../app/sync-filter';
import { keepAll } from '../core/keeps';
import { PIECE_SIZE, pieceHashes, pieceListHash, sha256Hex } from '../core/blobs/pieces';
import { MemoryBlobStore } from '../core/blobs/store';
import { decodeControl, decodeFilePiece, FRAME_FILE_PIECE } from './doc-mux';
import { FileTransfer, type FileHost, type WantedFile } from './file-transfer';

const UNIT = 'sp1';

function bytesOf(size: number, seed = 1): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = (i * 31 + seed * 7 + (i >> 8)) & 255;
  return b;
}

async function wantOf(bytes: Uint8Array, withPieces = true): Promise<WantedFile> {
  return { unit: UNIT, hash: await sha256Hex(bytes), size: bytes.length, ...(withPieces ? { pieces: await pieceListHash(await pieceHashes(bytes)) } : {}) };
}

/** One device: a store, a list of wanted files, and the peers it may talk to. */
function device(allow: (unit: string, peer: string) => boolean = () => true) {
  const store = new MemoryBlobStore();
  let wanted: WantedFile[] = [];
  const logs: string[] = [];
  const host: FileHost = {
    wanted: async () => {
      const out: WantedFile[] = [];
      for (const w of wanted) if (!(await store.get(w.hash))) out.push(w);
      return out;
    },
    store: () => store,
    allow,
    onChange: () => () => undefined,
    log: (t) => logs.push(t),
  };
  const t = new FileTransfer(host);
  return { store, t, logs, want: (w: WantedFile[]) => (wanted = w) };
}

type Dev = ReturnType<typeof device>;
/** Connect two devices as a direct link; `tamper` may change piece frames sent from `b` to `a`. */
function link(a: Dev, ida: string, b: Dev, idb: string, opts: { tamper?: (f: Uint8Array) => Uint8Array; drop?: () => boolean } = {}) {
  const deliver = (to: Dev, from: string, f: Uint8Array): void => {
    queueMicrotask(() => {
      if (f[0] === FRAME_FILE_PIECE) to.t.onPiece(from, f);
      else {
        const c = decodeControl(f);
        if (c) to.t.onControl(from, c);
      }
    });
  };
  a.t.peerDirect(idb, (f) => !opts.drop?.() && deliver(b, ida, f));
  b.t.peerDirect(ida, (f) => !opts.drop?.() && deliver(a, idb, opts.tamper && f[0] === FRAME_FILE_PIECE ? opts.tamper(f) : f));
}

const settle = async (ms = 60): Promise<void> => {
  for (let i = 0; i < ms; i++) await new Promise((r) => setTimeout(r, 1));
};

async function until(f: () => Promise<boolean>): Promise<boolean> {
  // A deadline, not a count of polls: on a busy machine each poll can take far longer than its sleep.
  const end = Date.now() + 20_000;
  while (Date.now() < end) {
    if (await f()) return true;
    await settle(5);
  }
  return false;
}

describe('file transfer', () => {
  it('fetches a multi-piece file over a direct link and verifies it', async () => {
    const data = bytesOf(PIECE_SIZE * 3 + 100);
    const w = await wantOf(data);
    const sender = device();
    const receiver = device();
    await sender.store.put(w.hash, new Blob([data]));
    receiver.want([w]);
    link(receiver, 'r', sender, 's');
    receiver.t.kick();
    expect(await until(async () => !!(await receiver.store.get(w.hash)))).toBe(true);
    const got = new Uint8Array(await (await receiver.store.get(w.hash))!.blob.arrayBuffer());
    expect(await sha256Hex(got)).toBe(w.hash);
    expect(receiver.store.pieces.size).toBe(0);
  });

  it('works for an entry without a piece-list hash (older index entries)', async () => {
    const data = bytesOf(PIECE_SIZE + 5);
    const w = await wantOf(data, false);
    const sender = device();
    const receiver = device();
    await sender.store.put(w.hash, new Blob([data]));
    receiver.want([w]);
    link(receiver, 'r', sender, 's');
    receiver.t.kick();
    expect(await until(async () => !!(await receiver.store.get(w.hash)))).toBe(true);
  });

  it('does nothing without a direct link: the file stays missing', async () => {
    const data = bytesOf(1000);
    const w = await wantOf(data);
    const receiver = device();
    receiver.want([w]);
    receiver.t.kick();
    await settle(30);
    expect(await receiver.store.get(w.hash)).toBeUndefined();
    expect(receiver.t.connected).toBe(false);
  });

  it('refuses a peer that is not allowed the unit', async () => {
    const data = bytesOf(1000);
    const w = await wantOf(data);
    const sender = device(() => false);
    const receiver = device();
    await sender.store.put(w.hash, new Blob([data]));
    receiver.want([w]);
    link(receiver, 'r', sender, 's');
    receiver.t.kick();
    await settle(60);
    expect(await receiver.store.get(w.hash)).toBeUndefined();
  });

  it('does not ask a peer that may not have the unit', async () => {
    const data = bytesOf(1000);
    const w = await wantOf(data);
    const sent: Uint8Array[] = [];
    const receiver = device((_u, peer) => peer !== 'x');
    receiver.want([w]);
    receiver.t.peerDirect('x', (f) => sent.push(f));
    receiver.t.kick();
    await settle(20);
    expect(sent).toHaveLength(0);
  });

  it('rejects a hostile piece and takes the file from another peer', async () => {
    const data = bytesOf(PIECE_SIZE * 2 + 1);
    const w = await wantOf(data);
    const good = device();
    const bad = device();
    const receiver = device();
    await good.store.put(w.hash, new Blob([data]));
    await bad.store.put(w.hash, new Blob([data]));
    receiver.want([w]);
    // Flip a byte in every piece the bad peer sends.
    link(receiver, 'r', bad, 'bad', {
      tamper: (f) => {
        const p = decodeFilePiece(f)!;
        const b = p.bytes.slice();
        b[0] = (b[0] ?? 0) ^ 1;
        return rebuild(p.unit, p.hash, p.index, b);
      },
    });
    receiver.t.kick();
    // Only the hostile peer is connected first, so its bad piece is certainly met.
    expect(await until(async () => receiver.logs.some((l) => l.includes('bad piece')))).toBe(true);
    expect(await receiver.store.get(w.hash)).toBeUndefined();
    link(receiver, 'r', good, 'good');
    expect(await until(async () => !!(await receiver.store.get(w.hash)))).toBe(true);
  });

  it('refuses a piece list that does not match the index', async () => {
    const data = bytesOf(PIECE_SIZE * 2);
    const other = bytesOf(PIECE_SIZE * 2, 9);
    const w = await wantOf(data);
    const liar = device();
    const receiver = device();
    // The liar serves other bytes under the wanted hash.
    await liar.store.put(w.hash, new Blob([other]));
    receiver.want([w]);
    link(receiver, 'r', liar, 'liar');
    receiver.t.kick();
    await settle(80);
    expect(await receiver.store.get(w.hash)).toBeUndefined();
    expect(receiver.logs.some((l) => l.includes('does not match'))).toBe(true);
  });

  it('resumes: pieces kept from an earlier try are not asked again', async () => {
    const data = bytesOf(PIECE_SIZE * 3);
    const w = await wantOf(data);
    const sender = device();
    const receiver = device();
    await sender.store.put(w.hash, new Blob([data]));
    await receiver.store.putPiece(w.hash, 0, data.slice(0, PIECE_SIZE));
    await receiver.store.putPiece(w.hash, 1, data.slice(PIECE_SIZE, PIECE_SIZE * 2));
    const asked: number[][] = [];
    receiver.want([w]);
    const real = sender.t.onControl.bind(sender.t);
    sender.t.onControl = (p, m) => {
      if (m.kind === 'file-get') asked.push(m.i as number[]);
      return real(p, m);
    };
    link(receiver, 'r', sender, 's');
    receiver.t.kick();
    expect(await until(async () => !!(await receiver.store.get(w.hash)))).toBe(true);
    expect(asked.flat()).toEqual([2]);
  });

  it('spreads pieces over several peers', async () => {
    const data = bytesOf(PIECE_SIZE * 20);
    const w = await wantOf(data);
    const a = device();
    const b = device();
    const receiver = device();
    await a.store.put(w.hash, new Blob([data]));
    await b.store.put(w.hash, new Blob([data]));
    const from = { a: 0, b: 0 };
    // Hold both peers' answers until both have been asked, so neither can take all 20 pieces (WINDOW is 8)
    // before the other's `file-have` arrives, whatever order the two arrive in.
    const asked = { a: false, b: false };
    let bothAsked!: () => void;
    const both = new Promise<void>((r) => (bothAsked = r));
    for (const [d, k] of [[a, 'a'], [b, 'b']] as const) {
      const real = d.t.onControl.bind(d.t);
      d.t.onControl = (p, m) => {
        if (m.kind !== 'file-get') return real(p, m);
        from[k] += (m.i as number[]).length;
        asked[k] = true;
        if (asked.a && asked.b) bothAsked();
        void both.then(() => real(p, m));
        return true;
      };
    }
    receiver.want([w]);
    link(receiver, 'r', a, 'a');
    link(receiver, 'r', b, 'b');
    receiver.t.kick();
    expect(await until(async () => !!(await receiver.store.get(w.hash)))).toBe(true);
    expect(from.a).toBeGreaterThan(0);
    expect(from.b).toBeGreaterThan(0);
    expect(from.a + from.b).toBe(20);
  });
});

import * as encoding from 'lib0/encoding';
function rebuild(unit: string, hash: string, index: number, bytes: Uint8Array): Uint8Array {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, FRAME_FILE_PIECE);
  encoding.writeVarString(enc, unit);
  encoding.writeVarString(enc, hash);
  encoding.writeVarUint(enc, index);
  encoding.writeUint8Array(enc, bytes);
  return encoding.toUint8Array(enc);
}

describe('file transfer with device keys required (#76, #166)', () => {
  const ACCOUNT = 'a'.repeat(24);
  const UNIT_ID = UNIT;
  /** The app's rule for files: `allowsDoc` for the space's document, keys required, both peers proven and keeping the space. */
  function rule(holders: string[]) {
    const account = new Y.Doc();
    keepAll(account, 'me', [UNIT_ID]);
    keepAll(account, 'granted', [UNIT_ID]);
    keepAll(account, 'ungranted', [UNIT_ID]);
    return (unit: string, peerId: string): boolean =>
      allowsDoc({
        docId: `space/${unit}`,
        peerId,
        account,
        accountId: ACCOUNT,
        me: 'me',
        paired: true,
        pairedAccountId: ACCOUNT,
        keys: { required: true, peerVerified: true, peerHolds: (s) => s === unit && holders.includes(peerId) },
      });
  }

  it('serves a space\'s file only to a peer that holds the space key', async () => {
    const data = bytesOf(PIECE_SIZE + 5);
    const w = await wantOf(data);
    const server = device(rule(['granted']));
    await server.store.put(w.hash, new Blob([data]));
    const out: Record<string, { frames: Uint8Array[] }> = {};
    for (const id of ['granted', 'ungranted']) {
      const rec: { frames: Uint8Array[] } = (out[id] = { frames: [] });
      server.t.peerDirect(id, (f) => rec.frames.push(f));
    }
    for (const id of ['granted', 'ungranted']) {
      server.t.onControl(id, { kind: 'file-want', unit: UNIT, hash: w.hash });
      server.t.onControl(id, { kind: 'file-get', unit: UNIT, hash: w.hash, i: [0, 1] });
    }
    await settle(40);
    const kinds = (id: string): string[] => out[id]!.frames.map((f) => (f[0] === FRAME_FILE_PIECE ? 'piece' : String(decodeControl(f)?.kind)));
    expect(kinds('granted').sort()).toEqual(['file-have', 'piece', 'piece']);
    // The peer without the grant learns only that nothing is here, and gets no piece.
    expect(kinds('ungranted')).toEqual(['file-none']);
  });

  it('does not ask a peer without the space key for a file', async () => {
    const data = bytesOf(1000);
    const w = await wantOf(data);
    const receiver = device(rule(['granted']));
    receiver.want([w]);
    const sent: Record<string, Uint8Array[]> = { granted: [], ungranted: [] };
    for (const id of ['granted', 'ungranted']) receiver.t.peerDirect(id, (f) => sent[id]!.push(f));
    receiver.t.kick();
    await settle(30);
    expect(sent.granted!.length).toBeGreaterThan(0);
    expect(sent.ungranted).toHaveLength(0);
  });
});
