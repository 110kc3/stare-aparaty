#!/usr/bin/env node

/**
 * Auto-discover camera listings from your OLX user page(s) and write them to
 * product-links.txt — replacing the manual "paste the links" step.
 *
 * It fetches each user page (pagination handled automatically), reads the
 * listing data OLX embeds in the page, keeps only the page owner's active
 * offers whose title matches a keyword, and writes the de-duplicated URLs to
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
 *   We collapse that escaping and pull out "title" / "status" / "url" / owning
 *   "user.id" for each offer. Only offers owned by the page's own user id are
 *   kept, so promoted/foreign ads never leak in. Out-of-range pages on OLX
 *   echo the last page's content, so we stop as soon as a page adds nothing new.
 */

const fs = require('node:fs');
const path = require('node:path');

// --- Config ----------------------------------------------------------------

// Your OLX user listing page(s). List only the FIRST page of each view — pages
// 2, 3, ... are fetched automatically until a page adds nothing new.
// categoryId=99 is OLX's "Foto" category; a user URL with no categoryId
// returns every category (the KEYWORDS filter still keeps only cameras).
const USER_PAGES = [
  'https://www.olx.pl/oferty/uzytkownik/273W5/?categoryId=99',
  'https://www.olx.pl/oferty/uzytkownik/vNQAM/',
];

// Keep an offer only if its title contains one of these (case-insensitive).
// This is the "is it actually a camera" safety net. Edit freely — note that
// some cameras are titled by brand/model only (e.g. "Pentax SF7"), so brand
// names are included on purpose. Set to [] to keep every offer.
const KEYWORDS = [
  'aparat', 'analog',
  // common analog-camera brands, so model-named listings aren't dropped:
  'pentax', 'canon', 'nikon', 'minolta', 'olympus', 'zenit', 'praktica',
  'zorki', 'fed', 'smena', 'lubitel', 'mamiya', 'chinon', 'petri', 'yashica',
  'exa', 'exakta', 'coronet', 'kodak', 'fujica', 'konica', 'rollei', 'quasar',
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

// Pull every offer (title, status, url, ownerId) out of one page's embedded
// JSON.
function extractOffers(html) {
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
  const seenUrls = new Set();
  let ownerId = null;

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = page === 1 ? firstPageUrl : withPage(firstPageUrl, page);
    let offers;
    try {
      offers = extractOffers(await fetchHtml(url));
    } catch (err) {
      console.error(`  page ${page}: fetch failed (${err.message})`);
      break;
    }
    if (offers.length === 0) break; // truly empty -> stop paginating

    // The page owner = whoever owns the most offers on page 1. Out-of-range
    // pages on OLX don't come back empty: they echo the last page's content
    // (and sometimes a rotating promoted ad from a DIFFERENT seller). So keep
    // only the owner's offers and stop as soon as a page adds none we haven't
    // already seen.
    if (ownerId === null) {
      const freq = {};
      for (const o of offers) freq[o.ownerId] = (freq[o.ownerId] || 0) + 1;
      ownerId = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0];
    }

    const fresh = offers.filter(
      (o) => o.ownerId === ownerId && !seenUrls.has(o.url),
    );
    if (fresh.length === 0) break;
    for (const o of fresh) seenUrls.add(o.url);

    console.log(`  page ${page}: ${fresh.length} new offer(s)`);
    collected.push(...fresh);
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

    for (const o of offers) {
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
