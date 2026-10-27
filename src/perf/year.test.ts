import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, loadavg } from 'node:os';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { AppContextValue } from '../app/context';
import { allSearchSources } from '../app/search-sources';
import '../notes/search-source';
import '../time/search-source';
import { rankItems, type SearchItem } from '../core/search';
import { buildIndex } from '../notes/note-store';
import { searchSpaces } from '../notes/search';
import { createSnapshot } from '../backup/snapshot';
import { buildReport, NO_FILTERS } from '../reports/aggregate';
import { loadSource } from '../reports/source';
import { liveEntries } from '../time/entries';
import { seedYear, type YearSpace } from './year-data';

/**
 * Performance with a year of data (#211). The numbers are the best of 7 runs on a laptop; the budgets are
 * about 4x that, so a slower CI runner passes and an accidental O(n²) does not. `PERF_REPORT=1 npx
 * vitest run src/perf` prints the table for docs/testing.md.
 */

const SCALE = Number(process.env.PERF_SCALE ?? 1);
const spaces: YearSpace[] = [seedYear('personal', 1, SCALE), seedYear('work', 2, SCALE)];
/** Wall-clock budgets stretch with machine load (other sessions, a browser suite), so contention does not fail them. */
const busy = (): number => Math.max(1, (loadavg()[0] ?? 0) / Math.max(1, cpus().length));
const results: { what: string; ms: number; budget: number }[] = [];

function measure<T>(what: string, budget: number, fn: () => T, runs = 7): T {
  let out!: T;
  const times: number[] = [];
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    out = fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  // The fastest run: a busy machine (parallel tests, a browser suite) slows single runs, not the best one.
  const ms = times[0] as number;
  results.push({ what, ms, budget });
  if (SCALE === 1) expect(ms, `${what}: ${ms.toFixed(1)} ms, budget ${budget} ms`).toBeLessThanOrEqual(budget * busy());
  return out;
}

const noteSets = spaces.map((s) => ({ id: s.spaceId, notes: buildIndex(s.doc).notes }));

const app = {
  spaceDocs: new Map(spaces.map((s) => [s.spaceId, s.doc])),
  privateDocs: new Map(spaces.map((s) => [s.spaceId, s.privateDoc])),
} as unknown as AppContextValue;

describe('a year of data', () => {
  it('has the size the issue asks for', () => {
    const entries = spaces.reduce((n, s) => n + liveEntries(s.privateDoc).length, 0);
    const notes = spaces.reduce((n, s) => n + buildIndex(s.doc).notes.length, 0);
    expect(entries).toBe(2500 * SCALE);
    expect(notes).toBe(3200 * SCALE);
  });

  it('first load: applying the stored documents', () => {
    const stored = spaces.flatMap((s) => [Y.encodeStateAsUpdate(s.doc), Y.encodeStateAsUpdate(s.privateDoc)]);
    results.push({ what: `stored size, ${(stored.reduce((n, u) => n + u.length, 0) / 1e6).toFixed(1)} MB`, ms: 0, budget: 0 });
    measure('first load / sync catch-up: apply all documents to an empty device', 1500, () => {
      for (const u of stored) Y.applyUpdate(new Y.Doc(), u);
    });
  });

  it('timer and week: live entries and report of one week', () => {
    const s = spaces[0] as YearSpace;
    measure('Timer / Week: read entries of one space', 60, () => liveEntries(s.privateDoc));
  });

  it('reports for a year', () => {
    const source = measure('Reports: read both spaces', 200, () =>
      loadSource(spaces.map((s) => ({ spaceId: s.spaceId, name: s.spaceId, doc: s.doc, privateDoc: s.privateDoc }))),
    );
    measure('Reports: aggregate a year', 300, () =>
      buildReport(source, { now: Date.UTC(2026, 9, 20), range: { from: Date.UTC(2025, 9, 20), to: Date.UTC(2026, 9, 21) }, weekStart: 'monday', filters: NO_FILTERS, groupBy: 'project', thenBy: 'description', multiSpace: true }),
    );
  });

  it('notes search', () => {
    measure('Notes search: one word across both spaces', 150, () =>
      searchSpaces(noteSets, 'meeting budget'),
    );
  });

  it('universal search', () => {
    const items = measure('Universal search: build the items (dialog opens)', 400, () =>
      app.spaceDocs.size ? [...app.spaceDocs.keys()].flatMap((id) => allSearchSources().flatMap((src) => src.collect(app, id))) : [],
    ) as SearchItem[];
    expect(items.length).toBeGreaterThan(5000);
    const names = new Map(spaces.map((s) => [s.spaceId, s.spaceId]));
    for (const q of ['meeting', 'budget review', '"design plan"', '#meeting1']) measure(`Universal search: rank "${q}" (each keystroke)`, 100, () => rankItems(items, q, names));
  });

  it('backup snapshot', async () => {
    const docs = new Map<string, Y.Doc>();
    for (const s of spaces) {
      docs.set(`space/${s.spaceId}`, s.doc);
      docs.set(`space/${s.spaceId}/private`, s.privateDoc);
    }
    // The fastest of 3, like `measure`: a busy machine slows single runs, not the best one.
    let ms = Infinity;
    let snap!: Awaited<ReturnType<typeof createSnapshot>>;
    for (let i = 0; i < 3; i++) {
      const t0 = performance.now();
      snap = await createSnapshot(docs, { deviceId: 'perf', reason: 'perf' });
      ms = Math.min(ms, performance.now() - t0);
    }
    results.push({ what: `Backup: snapshot of both spaces (${snap.files.size} files)`, ms, budget: 4000 });
    if (SCALE === 1) expect(ms).toBeLessThanOrEqual(4000 * busy());
  });

  it('writes the browser fixture when PERF_FIXTURE names a folder', () => {
    const dir = process.env.PERF_FIXTURE;
    if (!dir) return;
    mkdirSync(dir, { recursive: true });
    for (const s of spaces) {
      writeFileSync(`${dir}/${s.spaceId}.bin`, Y.encodeStateAsUpdate(s.doc));
      writeFileSync(`${dir}/${s.spaceId}-time.bin`, Y.encodeStateAsUpdate(s.privateDoc));
    }
  });

  it('prints the table', () => {
    if (process.env.PERF_REPORT) for (const r of results) console.log(`${r.ms.toFixed(1).padStart(8)} ms  (budget ${r.budget})  ${r.what}`);
  });
});
