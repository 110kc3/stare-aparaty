#!/usr/bin/env node

/**
 * Auto-discover camera listings from your OLX user page(s) and write them to
 * product-links.txt — replacing the manual "paste the links" step.
 *
 * It fetches each user page (pagination handled automatically), reads the
 * listing data OLX embeds in the page, keeps only YOUR own active offers whose
 * title matches a keyword, and writes the de-duplicated URLs to
 * product-links.txt. scripts/build-catalog.js then turns that into index.html
 * exactly as before.
 *
 * Usage:
 *   node scripts/discover-listings.js            # update product-links.txt
 *   node scripts/discover-listings.js --dry-run  # print results, write nothing
 *   node scripts/discover-listings.js --out tmp.txt   # write somewhere else
 *
 * Notes on how OLX serves the data:
 *   The user page is a client-rendered app, but it still ships the current
 *   page's listings as an escaped JSON blob in the HTML (slashes as /).
 *   We collapse that escaping and pull out "title" / "url" / owning "user.id"
 *   for each offer. Only offers owned by the page's own user id are kept, so
 *   promoted/foreign ads never leak in.
 */

const fs = require('node:fs');
const path = require('node:path');

// --- Config ----------------------------------------------------------------

// Your OLX user listing page(s). List only the FIRST page of each view — pages
// 2, 3, ... are fetched automatically until one comes back empty.
// categoryId=99 is OLX's "Foto" category.
const USER_PAGES = [
  'https://www.olx.pl/oferty/uzytkownik/273W5/?categoryId=99',
];

// Keep an offer only if its title contains one of these (case-insensitive).
// The OLX category filter already narrows things down, this is the extra
// "is it actually a camera" safety net. Edit freely — note that some cameras
// are titled by brand/model only (e.g. "Pentax SF7"), so brand names are
// included here on purpose. Set to [] to keep every offer in the category.
const KEYWORDS = [
  'aparat', 'analog',
  // common analog-camera brands, so model-named listings aren't dropped:
  'pentax', 'canon', 'nikon', 'minolta', 'olympus', 'zenit', 'praktica',
  'zorki', 'fed', 'smena', 'lubitel', 'mamiya', 'chinon', 'petri', 'yashica',
  'exa', 'exakta', 'coronet', 'kodak', 'fujica', 'konica', 'rollei',
];

const MAX_PAGES = 25; // safety cap on pagination
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const LINKS_FILE = path.resolve(__dirname, '..', 'product-links.txt');

// --- Implementation --------------------------------------------------------

function parseArgs(argv) {
  const out = { dryRun: false, outFile: LINKS_FILE };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry-run') out.dryRun = true;
    else if (argv[i] === '--out') {
      out.outFile = path.resolve(process.cwd(), argv[i + 1] || '');
      i += 1;
    }
  }
  return out;
}

async function fetchHtml(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl-PL,pl;q=0.9' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

// Pull every offer (title, url, ownerId) out of one page's embedded JSON.
function extractOffers(html) {
  // Collapse the JSON-string escaping: any run of backslashes before u002F
  // becomes "/", and escaped quotes become real quotes.
  const text = html.replace(/\\+u002F/gi, '/').replace(/\\+"/g, '"');

  const re =
    /"title":"([^"]*)","status":"([^"]*)","url":"(https:\/\/www\.olx\.pl\/d\/oferta\/[A-Za-z0-9-]+\.html)","user":\{"id":(\d+)/g;

  const offers = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    offers.push({
      title: decodeUnicode(m[1]),
      status: m[2],
      url: m[3],
      ownerId: m[4],
    });
  }
  return offers;
}

function decodeUnicode(value) {
  return value.replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) =>
    String.fromCharCode(parseInt(hex, 16)),
  );
}

function withPage(url, page) {
  const u = new URL(url);
  u.searchParams.set('page', String(page));
  return u.toString();
}

function matchesKeyword(title) {
  if (KEYWORDS.length === 0) return true;
  const t = title.toLowerCase();
  return KEYWORDS.some((k) => t.includes(k.toLowerCase()));
}

async function discoverFromUserPage(firstPageUrl) {
  const collected = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? firstPageUrl : withPage(firstPageUrl, page);
    let offers;
    try {
      offers = extractOffers(await fetchHtml(url));
    } catch (err) {
      console.error(`  page ${page}: fetch failed (${err.message})`);
      break;
    }
    if (offers.length === 0) break; // no more results -> stop paginating
    console.log(`  page ${page}: ${offers.length} offer(s)`);
    collected.push(...offers);
  }
  return collected;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const seen = new Set();
  const kept = [];
  const skipped = [];

  for (const userPage of USER_PAGES) {
    console.log(`Scanning ${userPage}`);
    const offers = await discoverFromUserPage(userPage);

    // The page owner is whoever owns the most offers on their own page.
    const freq = {};
    for (const o of offers) freq[o.ownerId] = (freq[o.ownerId] || 0) + 1;
    const ownerId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];

    for (const o of offers) {
      if (ownerId && o.ownerId !== ownerId) continue; // skip foreign ads
      if (o.status && o.status !== 'active') continue; // skip inactive
      if (seen.has(o.url)) continue;
      seen.add(o.url);
      if (matchesKeyword(o.title)) kept.push(o);
      else skipped.push(o);
    }
  }

  if (kept.length === 0) {
    console.error(
      '\nNo matching offers found. Leaving product-links.txt untouched ' +
        '(this is likely a transient OLX block — check USER_PAGES / KEYWORDS).',
    );
    process.exitCode = 1;
    return;
  }

  kept.sort((a, b) => a.title.localeCompare(b.title, 'pl'));
  const body = `${kept.map((o) => o.url).join('\n')}\n`;

  console.log(`\nKept ${kept.length} offer(s):`);
  for (const o of kept) console.log(`  + ${o.title}`);
  if (skipped.length) {
    console.log(`\nSkipped ${skipped.length} (no keyword match):`);
    for (const o of skipped) console.log(`  - ${o.title}`);
  }

  if (args.dryRun) {
    console.log('\n--dry-run: not writing any file.');
    return;
  }

  fs.writeFileSync(args.outFile, body, 'utf8');
  console.log(`\nWrote ${kept.length} link(s) to ${args.outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
