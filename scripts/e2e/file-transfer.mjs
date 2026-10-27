// End-to-end: files between two devices (#166 slice 2). A adds files to a note, B receives the bytes
// over the direct data channel in pieces, verified; a file added while apart arrives after reconnect.
//
//   npm run e2e file-transfer
//
import { BASE, launch, startMock, check, fail, watchPage, until, finish, newNote, keepAllSpaces, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const SPACE = 'space/personal';
const mock = await startMock();
const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'], viewport: { width: 1200, height: 900 } })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(mock.url);
  return page;
};
const a = await mk('A');
const b = await mk('B');
const st = (p) => p.evaluate(() => window.__app?.state());
// 150 KB of varied bytes: three pieces.
const BIG = Buffer.alloc(150 * 1024);
for (let i = 0; i < BIG.length; i++) BIG[i] = (i * 31 + (i >> 8)) & 255;
const SMALL = Buffer.from('hello from A');

try {
  await startSyncing(a);
  await joinByInvite(a, b);
  const t = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
  check(t >= 0, 'paired and connected');

  await a.goto(BASE + '?test#/notes');
  await newNote(a);
  await a.locator('input[aria-label="Note title"]').waitFor();
  await a.keyboard.type('Files');
  await a.keyboard.press('Enter');
  await a.locator('.note-editor').click();
  await a.getByLabel('Add files to this note').setInputFiles([
    { name: 'big.bin', mimeType: 'application/octet-stream', buffer: BIG },
    { name: 'small.txt', mimeType: 'text/plain', buffer: SMALL },
  ]);

  const held = (p) =>
    p.evaluate(async () => {
      const name = (await indexedDB.databases()).map((d) => d.name).find((n) => n?.startsWith('app-blobs-'));
      if (!name) return [];
      const db = await new Promise((res, rej) => {
        const r = indexedDB.open(name);
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }).catch(() => undefined);
      if (!db || !db.objectStoreNames.contains('files')) return [];
      return await new Promise((res) => {
        const r = db.transaction('files').objectStore('files').getAll();
        r.onsuccess = () => res(r.result.map((x) => x.size).sort((x, y) => x - y));
      });
    });
  const got = await until(async () => (await held(b)).join() === `${SMALL.length},${BIG.length}`, 30000);
  check(got >= 0, `B received both files over the direct link (${await held(b)})`);

  const idx = await b.evaluate(([id]) => window.__app.json(id, 'attachments'), [SPACE]);
  const entry = Object.values(idx ?? {}).find((e) => e.name === 'big.bin');
  check(!!entry?.pieces, 'the index entry carries the piece-list hash');

  // Added while apart: arrives after the link is back.
  await a.evaluate(() => window.__app.dropLink());
  await a.getByLabel('Add files to this note').setInputFiles([{ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('added while apart') }]);
  const late = await until(async () => (await held(b)).length === 3, 40000);
  check(late >= 0, `a file added while apart arrived after reconnect (${await held(b)})`);
} catch (e) {
  fail(String(e));
}
await finish(browser, mock);
