import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { DocSync } from '../sync/doc-sync';
import {
  counterTotal,
  createItem,
  getItems,
  getText,
  incrementCounter,
  setItemField,
  snapshot,
  softDeleteItem,
} from './space-doc';

/** Small deterministic PRNG so a failing seed can be replayed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Device {
  id: string;
  doc: Y.Doc;
}

interface Link {
  a: number;
  b: number;
  close(): void;
}

const FIELDS = ['name', 'note', 'color'];
const WORDS = ['alpha', 'beta', 'gamma', 'delta', 'x', 'yy'];

function pair(devices: Device[], a: number, b: number): Link {
  const da = devices[a]!.doc;
  const db = devices[b]!.doc;
  // eslint-disable-next-line prefer-const
  let syncB: DocSync;
  const syncA = new DocSync(da, (m) => syncB.receive(m));
  syncB = new DocSync(db, (m) => syncA.receive(m));
  syncA.start();
  syncB.start();
  return {
    a,
    b,
    close() {
      syncA.close();
      syncB.close();
    },
  };
}

interface RunResult {
  devices: Device[];
  incrementsTotal: number;
  deleted: Set<string>;
  allUpdates: Uint8Array[];
}

function run(seed: number, deviceCount: number, steps: number): RunResult {
  const rand = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)]!;

  const devices: Device[] = Array.from({ length: deviceCount }, (_, i) => ({
    id: `dev${i}`,
    doc: new Y.Doc(),
  }));
  const allUpdates: Uint8Array[] = [];
  for (const d of devices) d.doc.on('update', (u: Uint8Array) => allUpdates.push(u));

  const links = new Map<string, Link>();
  const key = (a: number, b: number): string => `${Math.min(a, b)}-${Math.max(a, b)}`;
  let incrementsTotal = 0;
  let nextItem = 0;
  const deleted = new Set<string>();
  /** Items this device currently holds; edits and deletes only touch those. */
  const held = (dev: Device): string[] => [...getItems(dev.doc).keys()];

  for (let step = 0; step < steps; step++) {
    const di = Math.floor(rand() * deviceCount);
    const dev = devices[di]!;
    const r = rand();

    if (r < 0.3) {
      const text = getText(dev.doc);
      text.insert(Math.floor(rand() * (text.length + 1)), pick(WORDS));
    } else if (r < 0.4) {
      const text = getText(dev.doc);
      if (text.length > 0) {
        const from = Math.floor(rand() * text.length);
        text.delete(from, 1 + Math.floor(rand() * Math.min(3, text.length - from)));
      }
    } else if (r < 0.5) {
      const by = 1 + Math.floor(rand() * 3);
      incrementCounter(dev.doc, dev.id, by);
      incrementsTotal += by;
    } else if (r < 0.58) {
      // A fresh id nobody else can create, as a UUID would be.
      createItem(dev.doc, `item-${nextItem++}`, { name: pick(WORDS) });
    } else if (r < 0.66) {
      const ids = held(dev);
      if (ids.length > 0) setItemField(dev.doc, pick(ids), pick(FIELDS), pick(WORDS));
    } else if (r < 0.7) {
      const ids = held(dev);
      if (ids.length > 0) {
        const id = pick(ids);
        softDeleteItem(dev.doc, id);
        deleted.add(id);
      }
    } else if (r < 0.85 && deviceCount > 1) {
      // Open a link between two devices.
      const other = (di + 1 + Math.floor(rand() * (deviceCount - 1))) % deviceCount;
      const k = key(di, other);
      if (!links.has(k)) links.set(k, pair(devices, di, other));
    } else if (deviceCount > 1) {
      // Drop a random link: a lid close, sleep or Wi-Fi change.
      const open = [...links.entries()];
      if (open.length > 0) {
        const [k, link] = pick(open);
        link.close();
        links.delete(k);
      }
    }
  }

  // Everyone reconnects: a full mesh, then all state must be identical.
  for (const link of links.values()) link.close();
  links.clear();
  for (let a = 0; a < deviceCount; a++) {
    for (let b = a + 1; b < deviceCount; b++) pair(devices, a, b).close();
  }
  return { devices, incrementsTotal, deleted, allUpdates };
}

function assertConverged(result: RunResult, label: string): void {
  const first = snapshot(result.devices[0]!.doc);
  for (const d of result.devices) {
    expect(snapshot(d.doc), `${label}: ${d.id} differs from dev0`).toEqual(first);
  }
  // No lost increments.
  expect(counterTotal(result.devices[0]!.doc), `${label}: counter total`).toBe(result.incrementsTotal);
  // Soft deletes are permanent: nothing deleted came back.
  const items = getItems(result.devices[0]!.doc);
  for (const id of result.deleted) {
    expect(items.get(id)?.get('deleted'), `${label}: ${id} resurrected`).toBe(true);
  }
  // Order independence: replaying every update in a different order gives the same state.
  const replay = new Y.Doc();
  const shuffled = [...result.allUpdates].reverse();
  for (const u of shuffled) Y.applyUpdate(replay, u);
  expect(snapshot(replay), `${label}: replay differs`).toEqual(first);
}

/** 200 seeds take a few seconds; the default 5 s test timeout is too tight on slow machines. */
const FUZZ_TIMEOUT_MS = 60_000;

describe('randomized multi-device merge', () => {
  for (const deviceCount of [2, 3]) {
    it(`converges across ${deviceCount} devices with link flapping (200 seeds)`, () => {
      for (let seed = 1; seed <= 200; seed++) {
        const result = run(seed, deviceCount, 120);
        assertConverged(result, `devices=${deviceCount} seed=${seed}`);
      }
    }, FUZZ_TIMEOUT_MS);
  }

  it('converges when every edit happens offline and devices meet only at the end', () => {
    for (let seed = 1000; seed < 1050; seed++) {
      const rand = mulberry32(seed);
      const devices: Device[] = [0, 1, 2].map((i) => ({ id: `dev${i}`, doc: new Y.Doc() }));
      let increments = 0;
      for (const d of devices) {
        for (let i = 0; i < 30; i++) {
          const text = getText(d.doc);
          text.insert(Math.floor(rand() * (text.length + 1)), WORDS[Math.floor(rand() * WORDS.length)]!);
          if (rand() < 0.3) {
            incrementCounter(d.doc, d.id);
            increments++;
          }
          if (i === 0) createItem(d.doc, `${d.id}-item`, { name: d.id });
          if (rand() < 0.3) setItemField(d.doc, `${d.id}-item`, FIELDS[Math.floor(rand() * FIELDS.length)]!, `${d.id}-${i}`);
        }
      }
      pair(devices, 0, 1).close();
      pair(devices, 1, 2).close();
      pair(devices, 0, 2).close();
      pair(devices, 0, 1).close();
      const first = snapshot(devices[0]!.doc);
      for (const d of devices) expect(snapshot(d.doc)).toEqual(first);
      expect(counterTotal(devices[0]!.doc)).toBe(increments);
    }
  });

  it('documents the pitfall: concurrent creation of the same key loses one side', () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    createItem(a, 'same', { fromA: 1 });
    createItem(b, 'same', { fromB: 1 });
    pair([{ id: 'a', doc: a }, { id: 'b', doc: b }], 0, 1).close();

    expect(snapshot(a)).toEqual(snapshot(b));
    const merged = getItems(a).get('same')!.toJSON() as Record<string, unknown>;
    // Exactly one record survives whole; records must therefore be created under fresh ids.
    expect(Object.keys(merged)).toHaveLength(1);
  });
});
