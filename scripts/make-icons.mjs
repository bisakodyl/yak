// Renders scripts/icons/app-icon.svg to the PNG app icons in public/ (installable-app manifest).
// The glyph sits inside the central 80% so the same file serves as the maskable icon.
// Run after changing the SVG, then commit the PNGs:  node scripts/make-icons.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const svg = readFileSync(new URL('./icons/app-icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const size of [192, 512]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size, height: size } });
    writeFileSync(new URL(`../public/icon-${size}.png`, import.meta.url), png);
    console.log(`public/icon-${size}.png`);
  }
} finally {
  await browser.close();
}
