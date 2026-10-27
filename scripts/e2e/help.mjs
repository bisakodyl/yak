// End-to-end: Help & About is one long page (#/help) with a table of contents; each entry jumps to its
// section (#/help/<section>), the section ids work after a reload and offline, the old
// #/manage/help address redirects, the header "?" opens it, Report a problem is a page of its own
// reachable from Help, the palette and the status popover, the shortcut list matches the bindings,
// and the header fits at 375 and 180 px.
//
//   npm run e2e help
//
import { BASE, launch, check, watchPage, poll, finish } from './lib.mjs';

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();
watchPage(page, 'help', { consoleErrors: true });
await page.goto(BASE + '?test#/timer');
await page.waitForFunction(() => window.__app);

// The header "?" opens Help.
await page.getByRole('link', { name: 'Help', exact: true }).click();
await page.getByRole('heading', { name: 'Help & About', level: 1 }).waitFor();
check(page.url().endsWith('#/help'), 'the ? opens #/help');
const main = await page.locator('main').innerText();
check(main.includes('Your Activity Keeper'), 'it says what Yak stands for');
check(main.includes('Version'), 'About shows a version');

const sections = ['About', 'What Yak stands for', 'Getting started', 'Timer and entries', 'Reports', 'Notes and tasks', 'Spaces', 'Devices and sync', 'Backup and restore', 'Browsers and phones', 'Obsidian plugin and folder mirror', 'Import from Toggl', 'Offline', 'Keyboard shortcuts', 'Privacy and data', 'Open source'];
const toc = page.getByRole('navigation', { name: 'Contents' });
for (const t of sections) {
  check((await toc.getByRole('link', { name: t, exact: true }).count()) === 1, `contents lists: ${t}`);
  check((await page.locator('main h2', { hasText: new RegExp(`^${t}$`) }).count()) === 1, `and the page has the section: ${t}`);
}

// A contents link jumps to its section on the same page.
await toc.getByRole('link', { name: 'Backup and restore', exact: true }).click();
check(page.url().endsWith('#/help/backups'), 'a contents link has a stable address');
check(await poll(() => page.evaluate(() => { const r = document.getElementById('help-backups')?.getBoundingClientRect(); return !!r && r.top >= -2 && r.top < 300; })) >= 0, 'it scrolls to the section');
check((await page.locator('main h2').count()) >= sections.length, 'all sections stay on one page');

// A section address opens at the section after a reload.
await page.goto(BASE + '?test#/help/privacy');
await page.waitForFunction(() => window.__app);
check(await poll(() => page.evaluate(() => { const r = document.getElementById('help-privacy')?.getBoundingClientRect(); return !!r && r.top >= -2 && r.top < 300; })) >= 0, 'a section address opens at the section');
const priv = await page.locator('#help-privacy').innerText();
for (const h of ['On your device', 'Between your own devices', 'What Cloudflare logs', 'Debug logs', 'Metrics', 'Reports by email']) check(priv.includes(h), `privacy covers: ${h}`);
check(priv.includes('7 days') && priv.includes('no warranty'), 'privacy states the log retention and the alpha warranty');

// Open source: the list matches the bundle (licenses.json), each package opens its licence text.
await page.goto(BASE + '?test#/help/open-source');
await page.waitForFunction(() => window.__app);
await page.locator('.oss-list li').first().waitFor();
const names = await page.locator('.oss-list summary strong').allInnerTexts();
const built = await (await page.request.get(BASE + 'licenses.json')).json();
check(names.length === built.length && built.every((e) => names.includes(e.name)), 'the list matches licenses.json');
for (const n of ['yjs', 'preact', 'jsqr', 'yaml', 'qrcode-generator', '@codemirror/view']) check(names.includes(n), `credits: ${n}`);
check((await page.request.get(BASE + 'THIRD-PARTY-LICENSES.txt')).ok(), 'THIRD-PARTY-LICENSES.txt is served');
await page.locator('.oss-list li').filter({ has: page.getByText('jsqr', { exact: true }) }).locator('summary').click();
check((await page.locator('.oss-list li').filter({ has: page.getByText('jsqr', { exact: true }) }).locator('pre').first().innerText()).includes('Apache License'), 'a package opens its licence text');
check((await page.locator('.oss-list li').filter({ has: page.getByText('yjs', { exact: true }) }).locator('summary').innerText()).includes('Kevin Jahns'), 'with its author');

// Shortcuts match the bindings.
const keys = await page.locator('#help-shortcuts tbody tr').evaluateAll((rows) => rows.map((r) => r.innerText));
check(keys.some((r) => r.includes('Show all commands') && r.includes('Alt P')), 'shortcuts: the palette');
check(keys.some((r) => r.includes('Go to Timer') && r.includes('Alt T')), 'shortcuts: Go to Timer');

// The old address redirects.
await page.evaluate(() => { location.hash = '#/manage/help/devices'; });
await page.waitForFunction(() => location.hash === '#/help/devices');
check(true, '#/manage/help/<x> redirects to #/help/<x>');

// Offline: the sections are in the bundle.
await context.setOffline(true);
await page.evaluate(() => { location.hash = '#/help/offline'; });
check(await poll(() => page.evaluate(() => !!document.getElementById('help-offline')?.innerText.includes('Needs a network'))) >= 0, 'sections open offline');
await context.setOffline(false);

// Report a problem: its own page, from Help and from the palette.
await page.evaluate(() => { location.hash = '#/help'; });
await page.getByRole('link', { name: 'Report a problem' }).first().click();
await page.getByRole('heading', { name: 'Report a problem', level: 1 }).waitFor();
check(page.url().endsWith('#/help/report'), 'Report a problem has its own page');
check((await page.locator('main h2', { hasText: 'Getting started' }).count()) === 0, 'and none of the guide');
await page.evaluate(() => { location.hash = '#/timer'; });
await page.keyboard.press('Alt+P');
await page.keyboard.type('report');
await page.getByText('Report a problem', { exact: true }).first().click();
await page.getByRole('heading', { name: 'Report a problem', level: 1 }).waitFor();
check(true, 'the palette opens it');

// The status popover offers it once an error was captured.
await page.evaluate(() => { location.hash = '#/timer'; });
await page.getByRole('button', { name: /^Backup and sync/ }).click();
check((await page.getByRole('link', { name: 'Report a problem' }).count()) === 0, 'no error: the popover does not offer it');
await page.keyboard.press('Escape');
await page.evaluate(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('e2e boom'), message: 'e2e boom' })));
await page.getByRole('button', { name: /^Backup and sync/ }).click();
check((await poll(async () => (await page.getByRole('link', { name: 'Report a problem' }).count()) === 1)) >= 0, 'after an error the popover offers it');
await page.keyboard.press('Escape');

// Devices links to its section.
await page.evaluate(() => { location.hash = '#/settings/devices'; });
await page.getByRole('link', { name: 'How this works' }).click();
check(page.url().endsWith('#/help/devices'), 'Devices links to its section');

// What's new: a device that never looked sees a dot; opening Help clears it.
const fresh = await context.newPage();
await fresh.goto(BASE + '?test#/timer');
await fresh.waitForFunction(() => window.__app);
check((await fresh.locator('.help-dot').count()) === 0, 'a new device has nothing new');
await fresh.evaluate(() => localStorage.setItem('app-changes-seen', '2000-01-01'));
await fresh.reload();
await fresh.waitForFunction(() => window.__app);
check((await fresh.locator('.help-dot').count()) === 1, 'something new since this device last looked: a dot on the ?');
await fresh.getByRole('link', { name: /^Help/ }).click();
check(await poll(() => fresh.locator('.help-dot').count().then((n) => n === 0)) >= 0, 'opening What\'s new clears the dot');
check((await fresh.evaluate(() => localStorage.getItem('app-changes-seen'))) > '2020', 'and remembers it');
const changes = await fresh.locator('#help-whats-new .change').count();
check(changes >= 1 && changes <= 5, `What's new lists the latest entries (${changes})`);
const newest = (await import('node:fs')).readFileSync(new URL('../../docs/user/changes.md', import.meta.url), 'utf8').match(/^## (\d{4}-\d\d-\d\d):/m)?.[1] ?? '';
check(newest !== '' && (await fresh.locator('#help-whats-new .change').first().innerText()).includes(newest), 'newest first');
await fresh.close();

// After a few days of use with data and no backup, the banner nudges (reusing the backup banner's rules).
const nudge = await context.newPage();
await nudge.goto(BASE + '?test#/timer');
await nudge.waitForFunction(() => window.__backup !== undefined);
await nudge.evaluate(async () => { await window.__backup.ready(); window.__backup.seed('personal', 'Personal'); });
check((await nudge.locator('.backup-banner').count()) === 0, 'a new device with data and no backup: no banner yet');
await nudge.evaluate(() => localStorage.setItem('app-backup-first-seen', String(Date.now() - 4 * 86_400_000)));
await nudge.reload();
await nudge.waitForFunction(() => window.__backup !== undefined);
check(await poll(async () => /Turn on backups/.test(await nudge.locator('.backup-banner').innerText().catch(() => ''))), 'four days in with no backup: the banner says Turn on backups');
await nudge.getByRole('button', { name: 'Remind me tomorrow' }).click();
check((await nudge.locator('.backup-banner').count()) === 0, 'Remind me tomorrow hides it');
await nudge.close();

// The alpha notice shows once per device.
const alpha = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const ap = await alpha.newPage();
await ap.goto(BASE + '?test&alpha#/timer');
await ap.waitForFunction(() => window.__app);
await ap.getByRole('status', { name: 'Yak is in alpha' }).waitFor();
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).innerText()).includes('backups'), 'the alpha notice mentions backups');
await ap.getByRole('button', { name: 'Got it' }).click();
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).count()) === 0, 'it can be dismissed');
await ap.reload();
await ap.waitForFunction(() => window.__app);
check((await ap.getByRole('status', { name: 'Yak is in alpha' }).count()) === 0, 'and does not come back');
await alpha.close();

// The header fits.
for (const [w, hidden] of [[375, false], [180, true]]) {
  await page.setViewportSize({ width: w, height: 800 });
  await page.evaluate(() => { location.hash = '#/timer'; });
  await page.locator('.topbar').waitFor();
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no sideways scroll at ${w} px`);
  check((await page.locator('.help-btn').isVisible()) === !hidden, `the ? is ${hidden ? 'hidden' : 'shown'} at ${w} px`);
}

// Help and About open before any space exists, from the Welcome screen's "?".
const wp = await (await browser.newContext({ viewport: { width: 1100, height: 900 } })).newPage();
watchPage(wp, 'welcome', { consoleErrors: true });
await wp.goto(BASE + '?test&welcome#/');
await wp.getByRole('heading', { name: /^Welcome to/ }).waitFor();
check((await wp.getByText('Track your time, and keep notes and tasks in Markdown.').count()) === 1, 'welcome says what Yak is');
check((await wp.getByRole('link', { name: 'Help' }).count()) === 1, 'welcome has the ? for Help');
await wp.getByRole('link', { name: 'Help' }).click();
await wp.getByRole('heading', { name: 'Help & About' }).waitFor();
check((await wp.getByRole('heading', { name: 'About', exact: true }).count()) === 1, 'Help opens on the welcome screen');
await wp.getByRole('button', { name: /Back to the welcome/ }).click();
await wp.getByRole('heading', { name: /^Welcome to/ }).waitFor();
check((await wp.locator('input[aria-label="One-time code"]').isVisible()) === false, 'joining and restoring wait behind one small line');

await finish(browser);
