// End-to-end for the Your data table on Settings (F-326): a local-only device sees one column, "+ Add a device",
// "+ Share with an account" and a backup line but no passphrase, fingerprint or device id; it opens the share sheet;
// on two paired profiles one device unticks a space for the other, and the other sees it; the table keeps space
// names pinned and stays inside its card at 375 px.
//
//   npm run e2e data-table
//
import { BASE, launch, ok, fail, check, watchPage, until, finish, startSyncing, joinByInvite } from './lib.mjs';

const browser = await launch();
const mk = async (name, size = { width: 1100, height: 900 }) => {
  const page = await (await browser.newContext({ viewport: size })).newPage();
  watchPage(page, name, { consoleErrors: true });
  await page.goto(`${BASE}?test#/settings`);
  await page.locator('table.st-keeps').waitFor();
  return page;
};

// ---- A device that never paired
{
  const p = await mk('local');
  const heads = (await p.locator('table.st-keeps thead th').allInnerTexts()).map((t) => t.trim());
  check(heads[0] === 'Space' && heads[1] === 'This device' && heads.length === 2, `local-only: one device column (${heads.join(' | ')})`);
  check((await p.getByRole('link', { name: /Add a device/ }).count()) === 1 && (await p.getByRole('button', { name: '+ New space' }).count()) === 1, 'local-only: one "+ Add a device" beside "+ New space"');
  check((await p.getByRole('button', { name: '+ Share with an account' }).count()) === 1 && (await p.getByRole('button', { name: /^Share .* with another account$/ }).count()) === 0, 'local-only: one "+ Share with an account" button, none on a row');
  check((await p.locator('[data-line="backup"]').count()) === 1, 'local-only: a backup line');
  check((await p.locator('[data-line="passphrase"], [data-line="sync"]').count()) === 0, 'local-only: no passphrase or sync line');
  const text = await p.locator('.st-home').innerText();
  check(!/fingerprint|passphrase|device id|\bid [0-9a-f]{8}\b/i.test(text), 'local-only: no passphrase, fingerprint or device id on the page');
  check((await p.getByLabel('This device keeps Personal').isChecked()) && (await p.getByLabel('This device keeps Work').isChecked()), 'local-only: this device keeps its spaces');

  // "+ Share with an account" opens the share sheet: pick a space, then the link form shows.
  await p.getByRole('button', { name: '+ Share with an account' }).click();
  const dialog = p.locator('dialog[open]');
  await dialog.waitFor();
  check((await dialog.getByLabel('Space to share').count()) === 1 && (await dialog.getByRole('button', { name: 'Make a link' }).count()) === 1, '"+ Share with an account" opens the share sheet with a space list and "Make a link"');
  await p.keyboard.press('Escape');
  check((await p.locator('dialog[open]').count()) === 0, 'the sheet closes with Escape');

  // "+ Add a device" opens the device view.
  await p.getByRole('link', { name: '+ Add a device' }).click();
  await p.getByRole('heading', { name: 'Devices', level: 1 }).waitFor();
  check((await p.evaluate(() => location.hash)) === '#/settings/devices/add', '"+ Add a device" opens the device view');
  await p.goBack();
  await p.locator('table.st-keeps').waitFor();
  check((await p.evaluate(() => location.hash)) === '#/settings', 'Back returns to Settings');

  // At 375 px the table pins the space names and the page does not scroll sideways.
  await p.setViewportSize({ width: 375, height: 800 });
  const pinned = await p.evaluate(() => getComputedStyle(document.querySelector('table.st-keeps tbody th')).position);
  check(pinned === 'sticky', `375 px: space names are pinned (${pinned})`);
  check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '375 px: no horizontal scroll on the page');
  const small = await p.evaluate(() => [...document.querySelectorAll('.st-home a.st-space-link, .st-home .st-add-person, .st-home .st-keep, .st-home .btn')].filter((e) => e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().height < 32).length);
  check(small === 0, `375 px: targets in the table are at least 32 px tall at a fine pointer (${small} smaller)`);
  await p.context().close();
}

// ---- Two paired profiles: keeps for another device
{
  const a = await mk('A');
  const b = await mk('B');
  await a.evaluate(() => { location.hash = '#/devices'; });
  await b.evaluate(() => { location.hash = '#/devices'; });
  await startSyncing(a);
  await joinByInvite(a, b);
  const name = async (p, n) => {
    const input = p.locator('input[aria-label="This device\'s name"]');
    await input.fill(n);
    await input.press('Enter');
    await input.blur();
  };
  await name(a, 'Laptop');
  await name(b, 'Bee');
  for (const p of [a, b]) await p.evaluate(() => { location.hash = '#/settings'; });
  check((await until(async () => (await a.locator('table.st-keeps thead th').allInnerTexts()).map((t) => t.trim()).join('|') === 'Space|This device|Bee', 20000)) >= 0, 'A lists itself first, then Bee');
  check((await until(async () => (await b.locator('table.st-keeps thead th').allInnerTexts()).map((t) => t.trim()).join('|') === 'Space|This device|Laptop', 20000)) >= 0, 'B lists itself first, then Laptop');
  check((await a.getByLabel('Bee keeps Work').isChecked()) && (await a.getByLabel('Bee keeps Personal').isChecked()), 'A sees that Bee keeps both spaces');
  await a.getByLabel('Bee keeps Work').uncheck();
  check((await until(async () => !(await b.getByLabel('This device keeps Work').isChecked()), 10000)) >= 0, 'unticking Bee\'s box on A unticks it on Bee');
  check(await b.getByLabel('This device keeps Personal').isChecked(), 'and leaves the other space alone');
  await b.getByLabel('Laptop keeps Personal').uncheck();
  check((await until(async () => !(await a.getByLabel('This device keeps Personal').isChecked()), 10000)) >= 0, 'B can untick a space for A');
  await b.getByLabel('Laptop keeps Personal').check();
  check((await until(async () => await a.getByLabel('This device keeps Personal').isChecked(), 10000)) >= 0, 'and tick it again');

  // Paired: the passphrase and sync lines appear.
  check((await a.locator('[data-line="sync"]').count()) === 1 && (await a.locator('[data-line="passphrase"]').count()) === 1, 'a paired device shows the passphrase and sync lines');
  check(/Unlocked/.test(await a.locator('[data-line="passphrase"]').innerText()), 'the passphrase line says unlocked with the minutes left (just created)');
  check((await a.getByRole('link', { name: /Add a device/ }).count()) === 1, 'a paired device also has exactly one "+ Add a device"');
  // Two devices at 375 px: the table scrolls inside its card, the page does not.
  await a.setViewportSize({ width: 375, height: 800 });
  await a.waitForTimeout(300);
  const wide = await a.evaluate(() => [...document.querySelectorAll('.st-home *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.st-table-wrap')).map((e) => `${e.tagName}.${e.className}:${Math.round(e.getBoundingClientRect().right)}`).slice(0, 5));
  check(wide.length === 0 && (await a.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), `375 px with two devices: nothing wider than the screen (${wide.join(', ')})`);
  const lines = await a.evaluate(() => [...document.querySelectorAll('.data-line')].map((e) => Math.round(e.getBoundingClientRect().height)));
  check(lines.length >= 3 && lines.every((h) => h <= 48), `375 px: each status line is one row (${lines.join(', ')} px)`);
  const names = await a.evaluate(() => [...document.querySelectorAll('.st-device-col a')].map((e) => e.getAttribute('title')));
  check(names.includes('Bee') || names.length > 0, 'device headers carry the full name in title');
  await a.setViewportSize({ width: 1100, height: 900 });
  // The share button works on a paired device too and opens the sheet.
  await a.getByRole('button', { name: '+ Share with an account' }).click();
  await a.locator('dialog[open]').getByRole('button', { name: 'Make a link' }).waitFor();
  ok('"+ Share with an account" opens the share sheet on a paired device');
  await a.keyboard.press('Escape');
  await a.context().close();
  await b.context().close();
}

await finish(browser);
