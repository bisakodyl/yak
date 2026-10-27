// End-to-end: two tabs of one browser profile and a second device. Only one tab syncs (a Web Lock);
// the other tab's edits go through it over a BroadcastChannel, and it takes over when that tab closes.
// The other device sees one link to the profile, not one per tab.
//
//   npm run e2e tabs
//
import { BASE, launch, startMock, ok, fail, check, watchPage, until, poll, finish, keepAllSpaces, openJoin, startSyncing, joinByInvite } from './lib.mjs';

const mock = await startMock();
const browser = await launch({ fakeCamera: true });
const open = async (context, n) => {
  const page = await context.newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test#/devices');
  await page.waitForFunction(() => window.__app);
  return page;
};
const profile = await browser.newContext({ permissions: ['camera'] });
const other = await browser.newContext({ permissions: ['camera'] });
const t1 = await open(profile, 'tab 1');
const c = await open(other, 'other device');
for (const p of [t1, c]) {
  await (await openJoin(p)).locator('summary', { hasText: /^Connection server$/ }).click();
  await p.locator('input[aria-label="Connection server"]').fill(mock.url);
}
const st = (p) => p.evaluate(() => window.__app?.state());
const text = (p) => p.evaluate(() => window.__app.text('space/work', 't'));

await startSyncing(t1);
await joinByInvite(t1, c);
const t = await until(async () => (await st(t1)) === 'connected' && (await st(c)) === 'connected', 20000);
t >= 0 ? ok(`paired and connected in ${t} ms`) : fail('did not connect');

const t2 = await open(profile, 'tab 2');
check(await poll(() => t2.evaluate(() => window.__app.otherTab()), 5000), 'the second tab follows the first');
check(await poll(async () => (await st(t2)) === 'connected', 5000), "the second tab shows the first tab's link state");
check(await poll(() => t2.getByText('Syncing in another tab').first().isVisible(), 5000), 'the second tab says another tab syncs');
check(!(await t1.evaluate(() => window.__app.otherTab())), 'the first tab still syncs');

await t2.evaluate(() => window.__app.append('space/work', 't', 'from tab 2 '));
check(await poll(async () => (await text(c))?.includes('from tab 2'), 5000), 'an edit in the following tab reaches the other device');
await c.evaluate(() => window.__app.append('space/work', 't', 'from the other device '));
check(await poll(async () => (await text(t2))?.includes('from the other device'), 5000), 'an edit on the other device reaches the following tab');
const peers = await c.evaluate(() => window.__app.peers());
check(peers.length === 1 && peers[0].state === 'connected', `the other device has one link to the profile (${JSON.stringify(peers.map((p) => p.state))})`);

await t1.close();
const r = await until(async () => !(await t2.evaluate(() => window.__app.otherTab())) && (await st(t2)) === 'connected', 30000);
r >= 0 ? ok(`the second tab took over and linked in ${r} ms`) : fail('the second tab did not take over');
await c.evaluate(() => window.__app.append('space/work', 't', 'after takeover '));
check(await poll(async () => (await text(t2))?.includes('after takeover'), 10000), 'edits arrive after the takeover');

await finish(browser, mock);
