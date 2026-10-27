import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MemoryStore } from '../core/history/memory-store';
import { HistoryRecorder } from '../core/history/recorder';
import { MemoryDir } from './dir';
import { copySegments, decodeSegment, encodeSegment, restorePointDue, stateAtTime, thinRestorePoints } from './incremental';
import { BackupService, type StoredStatus } from './service';
import { addEntry, seedSpace } from './testing';

const DAY = 86_400_000;

describe('segment files', () => {
  it('round-trip and are named by content', async () => {
    const seg = { docId: 'space/a', start: 5, end: 9, baseline: false, update: new Uint8Array([1, 2, 3]) };
    const a = await encodeSegment(seg);
    const b = await encodeSegment({ ...seg });
    expect(a.name).toBe(b.name);
    expect(a.name).not.toBe((await encodeSegment({ ...seg, update: new Uint8Array([1, 2, 4]) })).name);
    const back = decodeSegment(a.data);
    expect(back.header).toMatchObject({ doc: 'space/a', start: 5, end: 9 });
    expect([...back.update]).toEqual([1, 2, 3]);
  });

  it('copies only the segments the folder lacks, so a second run writes no duplicates', async () => {
    const store = new MemoryStore();
    const clock = { t: 1000 };
    const rec = new HistoryRecorder(store, () => clock.t, 60_000);
    const doc = new Y.Doc();
    await rec.attach('space/a', doc);
    seedSpace(doc, 'S');
    await rec.flush('space/a');
    const dir = new MemoryDir();
    const first = await copySegments(store, ['space/a'], dir);
    expect(Object.keys(first.written)).toHaveLength(2);
    const files = [...dir.files.keys()].sort();
    const second = await copySegments(store, ['space/a'], dir);
    expect(Object.keys(second.written)).toHaveLength(0);
    expect(second.present).toBe(2);
    expect([...dir.files.keys()].sort()).toEqual(files);
    // A new edit adds exactly one file.
    clock.t += 120_000;
    seedSpace(doc, 'T');
    await rec.flush('space/a');
    expect(Object.keys((await copySegments(store, ['space/a'], dir)).written)).toHaveLength(1);
  });
});

describe('restore points', () => {
  it('are due when none exists or the newest is a week old', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    expect(restorePointDue(undefined, now)).toBe(true);
    expect(restorePointDue(new Date(now - 2 * DAY).toISOString(), now)).toBe(false);
    expect(restorePointDue(new Date(now - 8 * DAY).toISOString(), now)).toBe(true);
  });

  it('are thinned to 4 weekly, 12 monthly, then yearly, keeping the newest of each', () => {
    const now = Date.parse('2026-10-15T12:00:00Z');
    const pts = [0, 1, 3, 8, 15, 22, 40, 50, 100, 400, 410, 800].map((d) => ({ name: `d${d}`, at: now - d * DAY }));
    const gone = new Set(thinRestorePoints(pts, now));
    expect(gone.has('d1')).toBe(true); // d0 is newer in the same week
    expect(gone.has('d0')).toBe(false);
    expect(gone.has('d8') || gone.has('d15') || gone.has('d22')).toBe(false); // one per week
    expect(gone.has('d410')).toBe(true); // d400 is newer in the same year (2025)
    expect(gone.has('d400')).toBe(false);
    expect(gone.has('d800')).toBe(false);
    expect(thinRestorePoints(pts.slice(0, 1), now)).toEqual([]);
  });
});

describe('restore to a time', () => {
  it('builds a restore point plus the segments that began by that time', async () => {
    const store = new MemoryStore();
    const clock = { t: Date.parse('2026-10-01T10:00:00Z') };
    const rec = new HistoryRecorder(store, () => clock.t, 60_000);
    const space = new Y.Doc();
    let saved: StoredStatus = {};
    const root = new MemoryDir();
    const service = new BackupService({
      docs: () => new Map([['space/a', space]]),
      deviceId: 'dev00000',
      accountId: 'acct',
      history: store,
      folder: { current: async () => ({ state: 'granted', id: 'f', name: 'B', dir: root }) },
      status: { load: () => saved, save: (s) => (saved = s) },
      now: () => new Date(clock.t),
    });
    await rec.attach('space/a', space);
    addEntry(space, '2026-10-01T09:00:00Z', '2026-10-01T09:30:00Z', 'one');
    await rec.flush('space/a');
    await service.run('manual', { force: true }); // restore point at 10:00
    const t1 = clock.t + 3 * DAY;
    clock.t = t1;
    addEntry(space, '2026-10-04T09:00:00Z', '2026-10-04T09:30:00Z', 'two');
    await rec.flush('space/a');
    clock.t += 3 * DAY;
    addEntry(space, '2026-10-07T09:00:00Z', '2026-10-07T09:30:00Z', 'three');
    await rec.flush('space/a');
    await service.run('hourly');

    const descriptions = async (at: number) => {
      const { docs } = await stateAtTime(root, 'acct', at);
      return Object.values(docs.get('space/a')?.getMap('time_entries').toJSON() ?? {}).map((e) => (e as { description: string }).description).sort();
    };
    expect(await descriptions(t1 + 1000)).toEqual(['one', 'two']);
    expect(await descriptions(clock.t + 1000)).toEqual(['one', 'three', 'two']);
    expect(await descriptions(Date.parse('2026-10-01T10:00:30Z'))).toEqual(['one']);
    // Before anything was recorded there is nothing to restore.
    await expect(stateAtTime(root, 'acct', Date.parse('2026-01-01T00:00:00Z'))).rejects.toThrow(/nothing/);
    // A damaged segment is refused.
    const seg = [...root.files.keys()].find((k) => k.endsWith('.seg')) as string;
    const bytes = root.files.get(seg) as Uint8Array;
    bytes[bytes.length - 1] = (bytes[bytes.length - 1] ?? 0) ^ 0xff;
    await expect(stateAtTime(root, 'acct', clock.t)).rejects.toThrow(/checksum/);
  });
});
