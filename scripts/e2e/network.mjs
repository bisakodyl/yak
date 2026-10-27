// End-to-end: the operator's Network stats page (#173) is not in the Manage list, asks for the admin key
// once, and says so when the relay has no operator stats (the mock relay answers 404 like a Worker without secrets).
//
//   npm run e2e network
//
import { BASE, launch, check, watchPage, finish } from './lib.mjs';

const browser = await launch();
const page = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watchPage(page, 'network');
await page.goto(BASE + '?test#/settings/devices');
await page.waitForFunction(() => window.__app);
check((await page.getByRole('link', { name: 'Network stats' }).count()) === 0, 'Network stats is not in the Manage list');
await page.evaluate(() => { location.hash = '#/settings/network'; });
await page.getByLabel('Admin key').fill('not-a-real-key');
await page.getByRole('button', { name: 'Show stats' }).click();
await page.getByText('This relay has no operator stats turned on.').waitFor();
check(true, 'a relay without operator stats says so');
check((await page.evaluate(() => localStorage.getItem('app-admin-key'))) === 'not-a-real-key', 'the key stays on this device');
await page.getByRole('button', { name: 'Forget the key' }).click();
check((await page.getByLabel('Admin key').count()) === 1 && (await page.evaluate(() => localStorage.getItem('app-admin-key'))) === null, 'forgetting the key asks again');
await finish(browser);
