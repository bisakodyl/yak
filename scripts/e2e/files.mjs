// End-to-end: files in notes (#166 slice 1) against dist/ served with the real headers, so a
// Content-Security-Policy violation (img-src blob:) fails the run. Sync is off throughout.
//
//   npm run e2e files
//
import { BASE, launch, fail, check, watchPage, until, finish, newNote } from './lib.mjs';

const SPACE = 'space/personal';
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>window.__pwned=1</script></svg>');

const browser = await launch();
try {
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await context.newPage();
  watchPage(page, 'A');
  await page.goto(BASE + '?test#/notes');
  await newNote(page);
  const title = page.locator('input[aria-label="Note title"]');
  await title.waitFor();
  await page.keyboard.type('Files');
  await page.keyboard.press('Enter');

  const editor = page.locator('.note-editor');
  await editor.click();
  await page.getByLabel('Add files to this note').setInputFiles([
    { name: 'dot.png', mimeType: 'image/png', buffer: PNG },
    { name: 'logo.svg', mimeType: 'image/svg+xml', buffer: SVG },
    { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') },
  ]);
  const index = () => page.evaluate(([id]) => window.__app.json(id, 'attachments'), [SPACE]);
  check((await until(async () => Object.keys((await index()) ?? {}).length === 3)) >= 0, 'three files are in the attachments index');
  const names = Object.values(await index()).map((a) => `${a.name}:${a.type}`).sort();
  check(names.join() === 'dot.png:image/png,logo.svg:application/octet-stream,notes.txt:application/octet-stream', `types come from the bytes: ${names.join()}`);

  // Move the cursor away so the embeds render instead of showing their source.
  await page.locator('.note-title').first().click();
  const img = editor.locator('img.cm-embed-img');
  check((await until(async () => (await img.count()) === 1)) >= 0, 'the PNG shows inline');
  check((await img.getAttribute('src'))?.startsWith('blob:'), 'the image is a blob: URL');
  check((await img.evaluate((i) => i.naturalWidth)) === 1, 'the image loaded (img-src allows blob:)');
  const chips = editor.locator('.cm-file-chip');
  check((await until(async () => (await chips.count()) === 2)) >= 0, 'SVG and text show as chips, not images');
  const link = chips.first().locator('a');
  check((await link.getAttribute('download')) === 'logo.svg' && (await link.getAttribute('href'))?.startsWith('blob:'), 'a chip downloads through a blob link');
  check((await link.getAttribute('target')) === null, 'a chip never opens a tab');
  check((await page.evaluate(() => window.__pwned)) === undefined, 'no script from the SVG ran');

  // Same bytes again: one index entry.
  await editor.click();
  await page.getByLabel('Add files to this note').setInputFiles([{ name: 'again.png', mimeType: 'image/png', buffer: PNG }]);
  await until(async () => (await page.locator('.note-editor').innerText()).length >= 0, 500);
  check(Object.keys(await index()).length === 3, 'the same bytes under another name add no entry');

  // Over the 10 MB cap: refused, nothing added.
  await page.getByLabel('Add files to this note').setInputFiles([{ name: 'big.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(10 * 1024 * 1024 + 1) }]);
  check((await until(async () => /per file/.test(await page.locator('body').innerText()))) >= 0, 'a file over 10 MB is refused with a message');
  check(Object.keys(await index()).length === 3, 'a refused file is not indexed');

  // Paste an image from the clipboard.
  await editor.click();
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])], 'image.png', { type: 'image/png' }));
    const target = document.querySelector('.note-editor').shadowRoot.querySelector('.cm-content');
    target.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  });
  check((await until(async () => Object.values((await index()) ?? {}).some((a) => /^Pasted image \d{8}-\d{6}\.png$/.test(a.name)))) >= 0, 'a pasted image gets a Pasted image name');

  // The files are still there after a reload.
  await page.reload();
  const again = page.locator('.note-editor img.cm-embed-img');
  check((await until(async () => (await again.count()) >= 1)) >= 0 && (await again.first().evaluate((i) => i.naturalWidth)) === 1, 'the image survives a reload');

  // Moving the note to another space copies its files (#272): the source keeps them, the image shows there.
  await page.locator('.note-row', { hasText: 'Files' }).hover();
  await page.getByRole('button', { name: 'More actions for Files' }).click();
  await page.getByRole('menuitem', { name: 'Move to…' }).click();
  await page.locator('dialog').getByLabel('Space', { exact: true }).selectOption({ label: 'Work' });
  await page.locator('dialog li', { hasText: 'Top level' }).click();
  const workIndex = () => page.evaluate(() => window.__app.json('space/work', 'attachments'));
  check((await until(async () => Object.keys((await workIndex()) ?? {}).length === 4)) >= 0, `the moved note’s files are in the other space’s index (${Object.values((await workIndex()) ?? {}).map((a) => a.name)})`);
  check((await until(async () => (await page.evaluate(() => window.__app.fileBytes('space/work'))) > 0)) >= 0, 'and their bytes are in its store');
  check(Object.keys(await index()).length >= 3 && (await page.evaluate(() => window.__app.fileBytes('space/personal'))) > 0, 'the source space keeps its files');
  await page.locator('.note-title').first().click();
  const moved = page.locator('.note-editor img.cm-embed-img');
  check((await until(async () => (await moved.count()) >= 1 && (await moved.first().evaluate((i) => i.naturalWidth)) === 1)) >= 0, 'the moved note shows its image in the new space');
} catch (e) {
  fail(`exception: ${e.stack || e}`);
}

await finish(browser);
