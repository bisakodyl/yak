// End-to-end: a full share between two profiles that never paired with another device of their own (#324).
// Each has one device. The owner makes a link on the space's page (Shared with) (the passphrase sheet creates the passphrase
// and the device's keys, no "Start syncing"), the joiner opens the link (the sheet again), both compare a code,
// the owner approves, and edits cross both ways. Also: the owner's second use needs no passphrase.
//
//   npm run e2e share-single
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, fillSheet } from './lib.mjs';

const PASS_A = 'e2e passphrase for single share A';
const PASS_B = 'e2e passphrase for single share B';
const browser = await launch({ fakeCamera: true });
const mk = async (n, hash) => {
  const page = await (await browser.newContext({ permissions: ['camera'] })).newPage();
  watchPage(page, n);
  await page.goto(BASE + '?test' + hash);
  await page.waitForFunction(() => window.__app);
  return page;
};
const hook = (p, f, arg) => p.evaluate(f, arg);
const append = (p, id, s) => hook(p, ([i, x]) => window.__app.append(i, 't', x), [id, s]);
const text = (p, id) => hook(p, (i) => window.__app.text(i, 't'), id);
const view = (p, space) => hook(p, (s) => window.__app.shareView(s), space);

const a = await mk('A', '#/settings');
const accountA = await hook(a, () => window.__app.accountId());
check(!(await hook(a, () => window.__app.pairedAccountId())), 'A never paired');
check(!(await hook(a, () => window.__app.keys())).required, 'A has no device keys yet');
const spaceS = await hook(a, () => window.__app.spaces().personal);
const docS = `space/${spaceS}`;
await append(a, docS, 'A-before ');

// The owner: on the space's page, + Share Personal with an account, Make a link: the sheet creates the passphrase and the device keys.
await a.evaluate((id) => { location.hash = `#/settings/space/${id}`; }, spaceS);
await a.getByRole('button', { name: '+ Share Personal with an account' }).click();
await a.getByLabel('Your name').fill('Alice');
await a.getByRole('button', { name: 'Make a link' }).click();
const sheetA = a.locator('[data-passphrase-sheet]');
await sheetA.waitFor({ timeout: 10000 });
check((await sheetA.getAttribute('data-passphrase-sheet')) === 'create', 'the sheet asks to create a passphrase');
check(await sheetA.getByRole('button', { name: 'Create and make a link' }).isVisible(), 'its button names the action');
check(!!(await sheetA.locator('[data-suggested-words]').innerText()), 'it suggests words');
await fillSheet(a, PASS_A);
const link = (await a.locator('[data-share-url]').innerText({ timeout: 30000 })).trim();
check(link.includes('#/share/'), `A has a share link`);
check((await hook(a, () => window.__app.keys())).required, 'A now has device keys for its single device');
check(!(await hook(a, () => window.__app.pairedAccountId())), 'and still never paired');

// The joiner opens the link on a device that is not set up.
const code = link.split('#/share/')[1];
const b = await mk('B', '#/share/' + code);
await b.getByLabel('Your name').fill('Bob');
await b.getByRole('button', { name: 'Ask to join' }).click();
const sheetB = b.locator('[data-passphrase-sheet]');
await sheetB.waitFor({ timeout: 10000 });
check(await sheetB.getByRole('button', { name: 'Create and ask to join' }).isVisible(), 'the joiner gets the same sheet');
await fillSheet(b, PASS_B);
const accountB = await hook(b, () => window.__app.accountId());
check(accountA !== accountB, 'two separate accounts');
const fpB = await hook(b, () => window.__app.accountFp());

const codeB = await b.locator('[data-compare]').innerText({ timeout: 40000 });
const codeA = await a.locator('.invite-requests [data-compare]').innerText({ timeout: 40000 });
check(codeA.trim() === codeB.trim(), `the codes match (${codeB.trim()})`);
await b.getByRole('button', { name: 'The codes match' }).click();
// The owner unlocked a moment ago: approving asks for nothing.
await a.locator('.invite-requests').getByRole('button', { name: 'Approve' }).click();
check(!(await a.locator('[data-passphrase-sheet]').count()), 'approving needs no passphrase while unlocked');
await b.locator('[data-share-done]').waitFor({ timeout: 40000 });
ok('B joined the shared space');
(await until(async () => (await view(b, spaceS))?.active && (await view(a, spaceS))?.members.includes(fpB), 30000)) >= 0 ? ok('both list B as a member') : fail('no roster');

(await until(async () => ((await text(b, docS)) ?? '').includes('A-before'), 60000)) >= 0 ? ok('B receives what A wrote') : fail('B has nothing of A');
await append(b, docS, 'B-edit ');
(await until(async () => ((await text(a, docS)) ?? '').includes('B-edit'), 60000)) >= 0 ? ok("B's edit reaches A") : fail('B edit did not arrive');
check(!(await hook(a, () => window.__app.docs())).some((d) => d === `account/${accountB}`), "A holds no document of B's account");
await finish(browser);
