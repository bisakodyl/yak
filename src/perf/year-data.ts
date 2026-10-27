import * as Y from 'yjs';
import { createRecord, initSpaceDoc } from '../core/schema';
import { mulberry32 } from '../time/testing';

/**
 * A year of plausible use, for measuring (docs/testing.md, "Performance"): per space about 1,250 time
 * entries, 20 projects, 5 clients, 40 tags, 1,000 notes of 300 to 3,000 characters with links and
 * tags, and 600 tasks. No personal data; fixed seed, so every run measures the same thing.
 */

export interface YearSpace {
  spaceId: string;
  doc: Y.Doc;
  privateDoc: Y.Doc;
}

const WORDS = ('meeting review design plan budget report client invoice sprint backlog release deploy bug fix test refactor email call notes ' +
  'research draft proposal workshop interview roadmap estimate contract hiring planning retro standup demo support onboarding docs migration ' +
  'security performance accessibility analytics pricing roadmap kickoff handover').split(' ');

function pick<T>(rand: () => number, list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T;
}

function sentence(rand: () => number, words: number): string {
  return Array.from({ length: words }, () => pick(rand, WORDS)).join(' ');
}

const iso = (ms: number): string => new Date(ms).toISOString();

/** `scale` multiplies the amount of data (3 = three years of the same use), to look for anything worse than linear. */
export function seedYear(spaceId: string, seed: number, scale = 1, end = Date.UTC(2026, 9, 20)): YearSpace {
  const rand = mulberry32(seed);
  const doc = new Y.Doc();
  const privateDoc = new Y.Doc();
  initSpaceDoc(doc);
  const clients = Array.from({ length: 5 }, (_, i) => createRecord(doc, 'clients', { name: `Client ${i + 1}`, archived: false, created_at: iso(end - 3e10), updated_at: iso(end - 3e10), deleted: false }));
  const projects = Array.from({ length: 20 }, (_, i) =>
    createRecord(doc, 'projects', {
      name: `Project ${i + 1} ${pick(rand, WORDS)}`,
      client_id: clients[i % clients.length],
      color: '#2f6fde',
      billable: i % 2 === 0,
      rate: i % 2 === 0 ? 100 : null,
      currency: 'USD',
      active: true,
      created_at: iso(end - 3e10),
      updated_at: iso(end - 3e10),
      deleted: false,
    }),
  );
  const tags = Array.from({ length: 40 }, (_, i) => `${pick(rand, WORDS)}${i}`);
  for (const t of tags) createRecord(doc, 'tags', { name: t, created_at: iso(end - 3e10), deleted: false });

  // About 5 entries a working day for 250 days.
  const year = 365 * 86400000;
  for (let day = 0; day < 250 * scale; day++) {
    const dayStart = end - year + Math.floor((day * 365) / 250 / scale) * 86400000 + 8 * 3600000;
    let t = dayStart;
    for (let k = 0; k < 5; k++) {
      const len = (15 + Math.floor(rand() * 90)) * 60000;
      createRecord(privateDoc, 'time_entries', {
        start: iso(t),
        stop: iso(t + len),
        duration: Math.round(len / 1000),
        description: sentence(rand, 2 + Math.floor(rand() * 4)),
        project_id: pick(rand, projects),
        task_id: null,
        tags: rand() < 0.4 ? [pick(rand, tags)] : [],
        billable: rand() < 0.5,
        device_id: 'perf-device',
        created_at: iso(t),
        updated_at: iso(t + len),
        deleted: false,
      });
      t += len + 10 * 60000;
    }
  }

  const folders = ['Projects', 'Meetings', 'Journal', 'Ideas', 'Reference'];
  for (let i = 0; i < 1000 * scale; i++) {
    const title = `${sentence(rand, 2)} ${i}`;
    const body = Array.from({ length: 3 + Math.floor(rand() * 20) }, () => sentence(rand, 8 + Math.floor(rand() * 12)))
      .map((s, k) => (k % 5 === 4 ? `See [[${sentence(rand, 2)} ${Math.floor(rand() * 1000)}]] and #${pick(rand, tags)}` : s))
      .join('\n\n');
    const text = new Y.Text();
    text.insert(0, `---\ntags: [${pick(rand, tags)}]\n---\n# ${title}\n\n${body}\n`);
    createRecord(doc, 'notes', { path: `${pick(rand, folders)}/${title}.md`, text, created_at: iso(end - rand() * year), updated_at: iso(end - rand() * 1e9), deleted: false });
  }
  for (let i = 0; i < 600 * scale; i++) {
    const title = `${sentence(rand, 3)} ${i}`;
    const text = new Y.Text();
    text.insert(0, `---\ntags: [task]\nstatus: ${pick(rand, ['open', 'in-progress', 'done'])}\npriority: ${pick(rand, ['low', 'normal', 'high'])}\ndue: 2026-${String(1 + Math.floor(rand() * 12)).padStart(2, '0')}-15\n---\n${sentence(rand, 12)}\n\n- [ ] ${sentence(rand, 4)}\n- [x] ${sentence(rand, 4)}\n`);
    createRecord(doc, 'notes', { path: `Tasks/${title}.md`, text, created_at: iso(end - rand() * year), updated_at: iso(end - rand() * 1e9), deleted: false });
  }
  return { spaceId, doc, privateDoc };
}
