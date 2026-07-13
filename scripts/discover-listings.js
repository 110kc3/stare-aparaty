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
// No categoryId is set on purpose: a bare user URL returns offers from EVERY
// category, so listings posted outside OLX's "Foto" category (e.g. a lens filed
// under accessories) are no longer missed. The KEYWORDS text filter below is
// what keeps only cameras/lenses, replacing the old category restriction.
const USER_PAGES = [
  'https://www.olx.pl/oferty/uzytkownik/273W5/',
  'https://www.olx.pl/oferty/uzytkownik/vNQAM/',
  'https://www.olx.pl/oferty/uzytkownik/2OYKZ/',
];

// Keep an offer only if its title contains one of these (case-insensitive).
// This is the "is it actually a camera/lens" safety net and — now that no OLX
// category filter is applied — the sole thing deciding what counts. Edit freely.
// 'obiektyw' matches lens listings (incl. inflections like "obiektywem").
// Note some cameras are titled by brand/model only (e.g. "Pentax SF7"), so
// brand names are included on purpose. Set to [] to keep every offer.
const KEYWORDS = [
  'aparat', 'analog', 'obiektyw',
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
      const value = argv[i + 1];
      // Fail fast: `path.resolve(cwd, '')` is the cwd itself, which would only
      // blow up with EISDIR at the final write — after all the fetching.
      if (!value) throw new Error('--out requires a file path');
      out.outFile = path.resolve(process.cwd(), value);
      i += 1;
    }
  }
  return out;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchHtml(url, { timeoutMs = 10000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl-PL,pl;q=0.9' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    } catch (err) {
      lastError = err;
      if (attempt < retries) await delay(300 * (attempt + 1));
    }
  }
  throw lastError;
}

// Pull every offer (title, status, url, ownerId) out of one page's embedded
// JSON. Tries a tight key-order-dependent regex first; if OLX ever reorders
// those keys (which would otherwise yield zero offers and fail the run), falls
// back to a looser, order-independent scan.
function extractOffers(html) {
  const strict = extractOffersStrict(html);
  return strict.length > 0 ? strict : extractOffersLoose(html);
}

function unescapeBlob(html) {
  return html.replace(/\\+u002F/gi, '/').replace(/\\+"/g, '"');
}

function extractOffersStrict(html) {
  const text = unescapeBlob(html);
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

// Order-independent recovery parser: anchor on each offer URL, then attach the
// title / status / owner id whose position is *nearest* to that URL. Less
// precise than the strict parser (a field could in theory bleed from a
// neighbouring offer), but within a single offer object the fields sit a few
// hundred chars apart, so nearest-wins resolves them reliably — and the
// downstream owner-frequency filter mops up any stray cross-bleed. "Roughly
// right" beats "zero offers, red run" when OLX changes its key order.
function extractOffersLoose(html) {
  const text = unescapeBlob(html);
  const urlRe = /"url":"(https:\/\/www\.olx\.pl\/d\/oferta\/[A-Za-z0-9-]+\.html)"/g;
  const titles = collectMatches(text, /"title":"([^"]*)"/g);
  const owners = collectMatches(text, /"user":\{[^}]*?"id":(\d+)/g);
  const statuses = collectMatches(text, /"status":"([^"]*)"/g);

  const offers = [];
  const seen = new Set();
  let m;
  while ((m = urlRe.exec(text)) !== null) {
    const url = m[1];
    if (seen.has(url)) continue;
    const title = nearestValue(titles, m.index);
    const ownerId = nearestValue(owners, m.index);
    if (title === undefined || ownerId === undefined) continue;
    seen.add(url);
    offers.push({
      title: decodeUnicode(title),
      status: nearestValue(statuses, m.index) || '',
      url,
      ownerId,
    });
  }
  return offers;
}

function collectMatches(text, re) {
  const out = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push({ index: m.index, value: m[1] });
  }
  return out;
}

function nearestValue(matches, anchorIndex) {
  let best;
  let bestDistance = Infinity;
  for (const match of matches) {
    const distance = Math.abs(match.index - anchorIndex);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = match.value;
    }
  }
  return best;
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

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}

module.exports = {
  extractOffers,
  extractOffersStrict,
  extractOffersLoose,
  decodeUnicode,
  matchesKeyword,
  withPage,
};
