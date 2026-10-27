// End-to-end: three isolated browser profiles join one account with one-time codes (a mesh: every
// device links to every other) over a local mock mailbox, and sync both space documents. Runs against dist/
// served with the real headers (scripts/serve-dist.mjs), so CSP violations fail the run.
//
//   npm run e2e app-mesh
//
import { BASE, launch, startMock, ok, fail, watchPage, until, finish, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const mock = await startMock();
const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(process.env.SIGNAL_URL || mock.url);
  return page;
};
const a = await mk('A');
const b = await mk('B');
const c = await mk('C');
const st = (p) => p.evaluate(() => window.__app?.state());
const peers = (p) => p.evaluate(() => window.__app.peers());
const fullyMeshed = async () => {
  for (const p of [a, b, c]) {
    const list = await peers(p);
    if (list.filter((x) => x.state === 'connected').length !== 2) return false;
  }
  return true;
};

await startSyncing(a);
// Each guest gets its own one-time code from A, then the third device could use any approved one.
for (const p of [b, c]) await joinByInvite(a, p);
const t = await until(fullyMeshed, 30000);
t >= 0 ? ok(`three devices meshed (each connected to two) in ${t} ms`) : fail('mesh did not form: ' + JSON.stringify(await Promise.all([a, b, c].map(peers))));
if (t < 0 && process.env.DEBUG_LOGS) for (const p of [a, b, c]) console.log('----\n' + (await p.evaluate(() => window.__app.report())));

const texts = (id) => Promise.all([a, b, c].map((p) => p.evaluate(([d]) => window.__app.text(d, 't'), [id])));
for (const space of ['space/personal', 'space/work']) {
  for (const [n, p] of [['A', a], ['B', b], ['C', c]]) await p.evaluate(([id, w]) => window.__app.append(id, 't', `from ${w} `), [space, n]);
  const same = await until(async () => {
    const [x, y, z] = await texts(space);
    return x === y && y === z && ['A', 'B', 'C'].every((w) => x.includes(`from ${w}`));
  }, 8000);
  same >= 0 ? ok(`${space} converged on all three`) : fail(`${space} did not converge: ${JSON.stringify(await texts(space))}`);
}

// Drop every link of C: A and B stay connected to each other, and C rejoins by itself.
await c.evaluate(() => window.__app.dropLink());
await a.evaluate(() => window.__app.append('space/work', 't', 'while C was away '));
const back = await until(async () => (await fullyMeshed()) && (await texts('space/work')).every((x) => x.includes('while C was away')), 30000);
back >= 0 ? ok(`C reconnected to both and caught up in ${back} ms`) : fail('C did not rejoin');

await b.reload();
const r = await until(fullyMeshed, 30000);
r >= 0 ? ok(`B resumed after a reload and re-meshed in ${r} ms`) : fail('B did not re-mesh after reload');

await finish(browser, mock);
