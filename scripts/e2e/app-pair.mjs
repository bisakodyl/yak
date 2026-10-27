// End-to-end: two isolated browser profiles open the app, pair through the Devices view with a
// short secret over a local mock mailbox, and sync both space documents. Runs against dist/
// served with the real headers (scripts/serve-dist.mjs), so CSP violations fail the run.
//
//   npm run e2e app-pair
//
import { BASE, launch, startMock, ok, fail, watchPage, until, finish, keepAllSpaces, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const mock = await startMock();
const browser = await launch({ fakeCamera: true });
const mk = async (n) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await (await openJoin(page)).locator('summary', { hasText: /^Connection server$/ }).click();
  await page.locator('input[aria-label="Connection server"]').fill(mock.url);
  return page;
};
const a = await mk('A');
const b = await mk('B');
const st = (p) => p.evaluate(() => window.__app?.state());

await startSyncing(a);
await joinByInvite(a, b);
const t = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected', 20000);
t >= 0 ? ok(`paired and connected in ${t} ms`) : fail('did not connect');

for (const space of ['space/personal', 'space/work']) {
  await a.evaluate(([id]) => window.__app.append(id, 't', 'from A '), [space]);
  await b.evaluate(([id]) => window.__app.append(id, 't', 'from B '), [space]);
  const same = await until(async () => {
    const [x, y] = await Promise.all([a.evaluate(([id]) => window.__app.text(id, 't'), [space]), b.evaluate(([id]) => window.__app.text(id, 't'), [space])]);
    return x === y && x.includes('from A') && x.includes('from B');
  }, 5000);
  same >= 0 ? ok(`${space} converged`) : fail(`${space} did not converge`);
}

await a.evaluate(() => window.__app.dropLink());
await b.evaluate(() => window.__app.append('space/work', 't', 'while apart '));
const r = await until(async () => (await st(a)) === 'connected' && (await st(b)) === 'connected' && (await a.evaluate(() => window.__app.text('space/work', 't'))).includes('while apart'), 20000);
r >= 0 ? ok(`reconnected and caught up in ${r} ms`) : fail('no reconnect after drop');

await b.reload();
const r2 = await until(async () => (await st(b)) === 'connected', 20000);
r2 >= 0 ? ok(`resumed pairing after reload in ${r2} ms`) : fail('no resume after reload');

// A catch-up larger than the data channel's max-message-size (256 KiB in Chromium) goes in pieces.
await a.evaluate(() => window.__app.dropLink());
await b.evaluate(() => window.__app.append('space/work', 'big', 'x'.repeat(2_000_000) + ' end'));
const r3 = await until(async () => (await st(a)) === 'connected' && (await a.evaluate(() => window.__app.text('space/work', 'big'))).endsWith(' end'), 30000);
r3 >= 0 ? ok(`2 MB catch-up arrived in ${r3} ms`) : fail('large catch-up did not arrive');

await finish(browser, mock);
