'use strict';

// Internal-link integrity for the generated site.
//
// Why this exists: the pages are generated from four separate templates, and
// several of the links between them are hand-written strings that point at
// something owned by a *different* file. `templates/guide.template.html` links
// to `../#filmy-bw`, `../#filmy-kolor` and `../#wywolywanie`, but those ids live
// in `templates/index.template.html` — so renaming one homepage section id
// would quietly break the same three links on all ten guide pages, and nothing
// in the build would notice: `assertNoPlaceholders` only checks that
// placeholders were filled, not that the resulting hrefs go anywhere.
//
// So this walks the committed output the way a crawler would and resolves every
// internal href against the file it lands in. No dependencies — the site is
// static HTML, and a regex sweep over generated markup is enough. It reads the
// generated files rather than rebuilding, so it never depends on OLX being up.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const GUIDES_DIR = 'poradniki';
const SITE_URL = 'https://stareaparaty.com/';

// Every page that ships in the Pages artifact and can contain links.
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

// Splits an href into the file it targets and the fragment it expects to find
// there. Returns null for anything that leaves the site (or isn't navigation).
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
  // A directory link is served by its index.html — which is also how a link to
  // a directory that has none would show up here as a missing file.
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
  // A sanity floor: if the regex ever stops matching, "0 broken" would be a
  // false pass rather than a clean site.
  assert.ok(checked > 100, `expected to check a substantial number of links, checked ${checked}`);
});

test('the guide pages still reach the homepage sections they advertise', () => {
  // The specific cross-file coupling described at the top of this file, pinned
  // explicitly so the failure message names the cause instead of a URL.
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
  // Guards a rename: guides.json owns the slug, and the slug determines both
  // the filename and the canonical URL. If those ever come apart, every guide
  // would tell Google to index a URL that 404s.
  for (const page of publicPages().filter((name) => name.startsWith(`${GUIDES_DIR}/`))) {
    const html = readPage(page);
    const canonical = html.match(/<link rel="canonical" href="([^"]+)">/);
    assert.ok(canonical, `${page} has no canonical link`);
    assert.equal(canonical[1], `${SITE_URL}${page}`, `${page} claims a different canonical URL`);
  }
});
