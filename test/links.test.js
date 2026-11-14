'use strict';


const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GUIDES_DIR = 'poradniki';
const SITE_URL = 'https://stareaparaty.com/';

function publicPages() {
  const guides = fs.readdirSync(path.join(ROOT, GUIDES_DIR))
    .filter((name) => name.endsWith('.html'))
    .map((name) => `${GUIDES_DIR}/${name}`);
  return ['index.html', '404.html', 'polityka-prywatnosci.html', ...guides];
}

const fileCache = new Map();

function readPage(relativePath) {
  if (!fileCache.has(relativePath)) {
    const absolute = path.join(ROOT, relativePath);
    fileCache.set(relativePath, fs.existsSync(absolute) && fs.statSync(absolute).isFile()
      ? fs.readFileSync(absolute, 'utf8')
      : null);
  }
  return fileCache.get(relativePath);
}

function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));
}

function resolveHref(href, fromPage) {
  if (/^(?:https?:|mailto:|tel:|data:|javascript:)/i.test(href) || href === '#' || href === '') {
    return null;
  }

  const [rawPath, fragment = ''] = href.split('#');
  if (rawPath === '') {
    return { page: fromPage, fragment };
  }

  const dir = path.posix.dirname(fromPage.split(path.sep).join('/'));
  let target = path.posix.normalize(path.posix.join(dir === '.' ? '' : dir, rawPath));
  if (target === '' || target === '.' || target.endsWith('/')) {
    target = `${target.replace(/\.?\/?$/, '')}${target && !target.endsWith('/') ? '/' : ''}index.html`;
  }
  return { page: target.replace(/^\.\//, ''), fragment };
}

test('every internal link on every generated page resolves', () => {
  const pages = publicPages();
  assert.ok(pages.length >= 12, `expected the generated site to be present, found ${pages.length} pages`);

  const broken = [];
  let checked = 0;

  for (const page of pages) {
    const html = readPage(page);
    assert.ok(html, `${page} is missing — run node scripts/build-catalog.js`);

    for (const match of html.matchAll(/(?:href|action)="([^"]*)"/g)) {
      const resolved = resolveHref(match[1], page);
      if (!resolved) {
        continue;
      }
      checked += 1;

      const targetHtml = readPage(resolved.page);
      if (targetHtml === null) {
        broken.push(`${page} → ${match[1]} (no such file: ${resolved.page})`);
        continue;
      }
      if (resolved.fragment && !idsIn(targetHtml).has(resolved.fragment)) {
        broken.push(`${page} → ${match[1]} (no #${resolved.fragment} in ${resolved.page})`);
      }
    }
  }

  assert.deepEqual(broken, [], `broken internal links:\n  ${broken.join('\n  ')}`);
  assert.ok(checked > 100, `expected to check a substantial number of links, checked ${checked}`);
});

test('the guide pages still reach the homepage sections they advertise', () => {
  const homepage = readPage('index.html');
  const homepageIds = idsIn(homepage);
  for (const anchor of ['aparaty', 'filmy-bw', 'filmy-kolor', 'wywolywanie']) {
    assert.ok(
      homepageIds.has(anchor),
      `index.html has no #${anchor}; the guide template links to ../#${anchor} from all ten guides`,
    );
  }
});

test('every sitemap URL points at a file that actually ships', () => {
  const sitemap = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.ok(locations.length > 0, 'sitemap contains no <loc> entries');

  for (const location of locations) {
    assert.ok(location.startsWith(SITE_URL), `${location} is not on the canonical domain`);
    const relative = location.slice(SITE_URL.length) || 'index.html';
    assert.ok(readPage(relative), `sitemap lists ${location} but ${relative} does not exist`);
  }
});

test('each guide declares itself canonical at the path it was written to', () => {
  for (const page of publicPages().filter((name) => name.startsWith(`${GUIDES_DIR}/`))) {
    const html = readPage(page);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
    assert.ok(canonical, `${page} has no canonical link`);
    assert.equal(canonical[1], `${SITE_URL}${page}`, `${page} claims a different canonical URL`);
  }
});
