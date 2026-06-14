#!/usr/bin/env node

/**
 * Rasterize favicon.svg into the PNG app icons that SVG can't cover:
 *   - apple-touch-icon.png (180×180) — iOS home-screen icon (iOS ignores SVG)
 *   - icon-192.png / icon-512.png    — Android / PWA manifest icons
 *
 * The favicon is 16×16 pixel art, so we upscale it with nearest-neighbour
 * (image-rendering: pixelated) to keep the retro blocks crisp instead of
 * blurring them. Run this whenever favicon.svg changes:
 *
 *   node scripts/generate-icons.js
 *
 * Needs Playwright + Chromium (a devDependency, same as refresh-amazon.js).
 */

const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT_DIR = path.resolve(__dirname, '..');
const SVG = fs.readFileSync(path.join(ROOT_DIR, 'favicon.svg'), 'utf8');

const TARGETS = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

async function main() {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ deviceScaleFactor: 1 });
    for (const { file, size } of TARGETS) {
      const html =
        '<!doctype html><html><head><style>' +
        '*{margin:0;padding:0}' +
        `html,body{width:${size}px;height:${size}px;overflow:hidden;background:#0e0b08}` +
        `svg{width:${size}px;height:${size}px;display:block;image-rendering:pixelated}` +
        `</style></head><body>${SVG}</body></html>`;
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(html, { waitUntil: 'load' });
      await page.screenshot({
        path: path.join(ROOT_DIR, file),
        clip: { x: 0, y: 0, width: size, height: size },
      });
      console.log(`wrote ${file} (${size}×${size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
