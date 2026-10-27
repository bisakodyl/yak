import { describe, expect, it } from 'vitest';
import type * as Y from 'yjs';
import { addManualEntry, deleteEntry, editEntry, findRunning, liveEntries, type TimeDocs, splitEntry, startTimer, stopTimer } from './entries';
import { enforceSingleRunning } from './rule';
import { at, makeSpaceDocs, mulberry32, syncDevices } from './testing';

const T0 = at(2026, 10, 14, 9, 0);
const MIN = 60_000;

describe('running-timer rule', () => {
  it('stops the older of two concurrent timers at the later start', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    const ea = startTimer(a, 'personal', 'A', { description: 'a' }, T0);
    const eb = startTimer(b, 'work', 'B', { description: 'b' }, T0 + 5 * MIN);
    syncDevices(a, b);
    expect(findRunning(a)).toHaveLength(2);
    expect(enforceSingleRunning(a).map((s) => s.id)).toEqual([ea.id]);
    expect(enforceSingleRunning(a)).toHaveLength(0); // idempotent
    const stopped = liveEntries(a.get('personal')!).find((e) => e.id === ea.id)!;
    expect(stopped.duration).toBe(300);
    expect(findRunning(a).map((r) => r.id)).toEqual([eb.id]);
  });

  it('breaks ties on the start time by id, the same way everywhere', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    startTimer(a, 'personal', 'A', {}, T0);
    startTimer(b, 'personal', 'B', {}, T0);
    syncDevices(a, b);
    enforceSingleRunning(a);
    enforceSingleRunning(b);
    syncDevices(a, b);
    expect(findRunning(a)).toHaveLength(1);
    expect(findRunning(a)[0]!.id).toBe(findRunning(b)[0]!.id);
  });

  it('chains three timers without overlap', () => {
    const [d1, d2, d3] = [makeSpaceDocs(), makeSpaceDocs(), makeSpaceDocs()];
    startTimer(d1, 'personal', '1', {}, T0);
    startTimer(d2, 'work', '2', {}, T0 + 10 * MIN);
    startTimer(d3, 'personal', '3', {}, T0 + 30 * MIN);
    syncDevices(d1, d2);
    syncDevices(d1, d3);
    enforceSingleRunning(d1);
    const durations = [...d1.values()].flatMap((doc) => liveEntries(doc).map((e) => e.duration)).sort((x, y) => x - y);
    expect(durations).toEqual([0, 600, 1200]);
  });

  it('ignores deleted running entries', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    const e = startTimer(a, 'personal', 'A', {}, T0);
    syncDevices(a, b);
    deleteEntry(b.get('personal')!, e.id, T0 + MIN);
    startTimer(b, 'work', 'B', {}, T0 + 2 * MIN);
    syncDevices(a, b);
    expect(enforceSingleRunning(a)).toHaveLength(0);
  });
});

// ---- randomized multi-device convergence ----

interface Device {
  name: string;
  docs: Map<string, Y.Doc>;
}

/** Stable text for a document's time entries: keys sorted, since map iteration order may differ per device. */
function canonical(doc: Y.Doc): string {
  const sortKeys = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sortKeys)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, x]) => [k, sortKeys(x)]))
        : v;
  return JSON.stringify(sortKeys(doc.getMap('time_entries').toJSON()));
}

function snapshotOf(d: Device): string {
  return [...d.docs.keys()].sort().map((id) => canonical(d.docs.get(id)!)).join('|');
}

function syncAll(devices: Device[]): void {
  for (let i = 0; i < devices.length; i++) {
    for (let j = i + 1; j < devices.length; j++) syncDevices(devices[i]!.docs, devices[j]!.docs);
  }
}

function runFuzz(seed: number, deviceCount: number, steps: number): void {
  const rnd = mulberry32(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!;
  const devices: Device[] = Array.from({ length: deviceCount }, (_, i) => ({ name: `dev-${i}`, docs: makeSpaceDocs() }));
  const spaces = ['personal', 'work'];
  let clock = T0;

  for (let step = 0; step < steps; step++) {
    clock += Math.floor(rnd() * 20 * MIN) + 1000;
    const d = pick(devices);
    const space = pick(spaces);
    const doc = d.docs.get(space)!;
    const roll = rnd();
    const entries = liveEntries(doc);
    if (roll < 0.35) {
      startTimer(d.docs, space, d.name, { description: `t${step}` }, clock);
    } else if (roll < 0.5) {
      const running = findRunning(d.docs);
      const r = running.length ? pick(running) : undefined;
      if (r) stopTimer(d.docs.get(r.spaceId)!, r.id, clock);
    } else if (roll < 0.6 && entries.length) {
      deleteEntry(doc, pick(entries).id, clock);
    } else if (roll < 0.7 && entries.length) {
      editEntry(doc, pick(entries).id, { description: `e${step}`, billable: rnd() < 0.5 });
    } else if (roll < 0.78) {
      addManualEntry(doc, d.name, { start: clock - 30 * MIN, stop: clock - 10 * MIN, description: `m${step}` });
    } else if (roll < 0.85 && entries.length) {
      const e = pick(entries);
      splitEntry(doc, d.name, e.id, new Date(e.start).getTime() + 5 * MIN, clock);
    } else {
      // connectivity: two random devices exchange state, then each applies the rule as its observers would
      const x = pick(devices);
      const y = pick(devices);
      if (x !== y) {
        syncDevices(x.docs, y.docs);
        enforceSingleRunning(x.docs);
        enforceSingleRunning(y.docs);
      }
    }
  }

  // Everyone comes online: sync, apply the rule on each device, repeat until nothing changes.
  for (let round = 0; round < 25; round++) {
    syncAll(devices);
    const changed = devices.map((d) => enforceSingleRunning(d.docs).length).reduce((a, b) => a + b, 0);
    const same = devices.every((d) => snapshotOf(d) === snapshotOf(devices[0]!));
    if (changed === 0 && same) break;
  }
  syncAll(devices);

  const first = snapshotOf(devices[0]!);
  for (const d of devices) {
    if (snapshotOf(d) !== first) throw new Error(`seed ${seed}: ${d.name} diverged`);
    expect(findRunning(d.docs).length, `seed ${seed}: more than one running timer`).toBeLessThanOrEqual(1);
    for (const doc of d.docs.values()) {
      for (const e of liveEntries(doc)) {
        if (e.stop !== null) {
          expect(new Date(e.stop).getTime(), `seed ${seed}: stop before start`).toBeGreaterThanOrEqual(new Date(e.start).getTime());
        }
      }
    }
  }
}

describe('randomized multi-device convergence', () => {
  it('two devices, two spaces: one running timer and identical state', () => {
    for (let seed = 1; seed <= 150; seed++) runFuzz(seed, 2, 40);
  });

  it('three devices, two spaces', () => {
    for (let seed = 1000; seed < 1080; seed++) runFuzz(seed, 3, 50);
  });
});

describe('observer-style application', () => {
  it('converges when each device enforces on every incoming update', () => {
    const a = makeSpaceDocs();
    const b = makeSpaceDocs();
    startTimer(a, 'personal', 'A', {}, T0);
    startTimer(b, 'personal', 'B', {}, T0 + MIN);
    // both enforce right after every sync, as the app does when time_entries changes
    for (let i = 0; i < 3; i++) {
      syncDevices(a as TimeDocs, b as TimeDocs);
      enforceSingleRunning(a);
      enforceSingleRunning(b);
    }
    expect(canonical(a.get('personal')!)).toBe(canonical(b.get('personal')!));
    expect(findRunning(a)).toHaveLength(1);
  });
});
