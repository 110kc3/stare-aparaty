#!/usr/bin/env node


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
