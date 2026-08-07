#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LINKS_FILE = path.join(ROOT_DIR, 'product-links.txt');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'index.template.html');
const PRIVACY_TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'privacy.template.html');
const GUIDE_TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'guide.template.html');
const GUIDES_FILE = path.join(__dirname, 'guides.json');
const AMAZON_PRODUCTS_FILE = path.join(__dirname, 'amazon-products.json');
const ALLEGRO_PRODUCTS_FILE = path.join(__dirname, 'allegro-products.json');
const CAMERA_TYPES_FILE = path.join(__dirname, 'camera-types.json');
const CAMERA_NOTES_FILE = path.join(__dirname, 'camera-notes.json');
// How long a freshly-discovered listing keeps its NOWE chip.
const NEW_ARRIVAL_DAYS = 14;
const ADS_CONFIG_FILE = path.join(__dirname, 'ads-config.json');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_JSON = path.join(ROOT_DIR, 'olx_meta.json');
const OUTPUT_SITEMAP = path.join(ROOT_DIR, 'sitemap.xml');
const LLMS_FILE = path.join(ROOT_DIR, 'llms.txt');
const OUTPUT_LLMS_FULL = path.join(ROOT_DIR, 'llms-full.txt');
const OUTPUT_ADS_TXT = path.join(ROOT_DIR, 'ads.txt');

const SITE_URL = 'https://stareaparaty.com/';
const PRIVACY_PATH = 'polityka-prywatnosci.html';
const OUTPUT_PRIVACY = path.join(ROOT_DIR, PRIVACY_PATH);
// Bumped by hand when the policy text itself changes. Deliberately NOT the
// build date: the page rebuilds daily with the catalog, and a date that moved
// every night would tell readers "this policy changed" when it hadn't.
//
// Last bump 2026-08-07, when §1 (data controller) was settled. The site is run
// by a private individual, not a registered business, so the policy names a
// natural person and carries no company name, address or NIP — that is
// deliberate, not an unfilled placeholder, and it should not be "fixed" by
// inventing business details. RODO art. 13(1)(a-b) wants the controller's
// identity and a working contact channel; support@stareaparaty.com is it.
// If the site ever starts operating under a działalność gospodarcza, §1 needs
// that entity's name, address and NIP, and this date needs another bump.
const PRIVACY_UPDATED = '7 sierpnia 2026';
// Per-camera-type buyer guides live in their own directory so the deploy
// workflows can ship them with one `cp -r` instead of a filename per guide.
const GUIDES_DIR = 'poradniki';
const OUTPUT_GUIDES_DIR = path.join(ROOT_DIR, GUIDES_DIR);

// Up to this many listings are fetched at once. OLX tolerates a handful of
// concurrent requests fine, and a bounded pool keeps the whole catalog from
// rebuilding strictly one-at-a-time.
const FETCH_CONCURRENCY = 5;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const links = loadLinks(args);
  const previousMetadata = loadPreviousMetadata();

  // Fetch listings concurrently (bounded) but keep the original link order.
  const items = await mapWithConcurrency(links, FETCH_CONCURRENCY, (link) =>
    buildItem(link, previousMetadata.get(link)),
  );

  const today = todayInWarsaw();
  const normalizedItems = items.map((item, index) => ({
    id: index + 1,
    title: item.title,
    image: item.image,
    url: item.url,
    host: item.host,
    sold: !!item.sold,
    price: item.price || '',
    oldPrice: item.oldPrice || '',
    firstSeen: resolveFirstSeen(item.url, previousMetadata, today),
    // HTTP validators, persisted so the next run can send a conditional request.
    etag: item.etag || '',
    lastModified: item.lastModified || '',
  }));

  reportFetchHealth(summarizeFetchHealth(items), {
    strict: args.strict,
    annotate: !!process.env.GITHUB_ACTIONS,
  });

  if (args.writeLinksFile) {
    fs.writeFileSync(LINKS_FILE, `${links.join('\n')}\n`, 'utf8');
  }

  // Loaded once so the page markup and ads.txt can never disagree about which
  // publisher account this domain belongs to.
  const ads = loadAdsConfig();

  const html = renderIndex(normalizedItems, ads);
  assertRenderedOutput(html, normalizedItems.length);

  const privacyHtml = renderPrivacyPolicy(ads);
  const guides = writeGuides(normalizedItems, ads);

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(normalizedItems, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  fs.writeFileSync(OUTPUT_PRIVACY, privacyHtml, 'utf8');
  fs.writeFileSync(OUTPUT_SITEMAP, renderSitemap(guides), 'utf8');
  fs.writeFileSync(OUTPUT_ADS_TXT, renderAdsTxt(ads), 'utf8');
  fs.writeFileSync(OUTPUT_LLMS_FULL, renderLlmsFull(normalizedItems), 'utf8');

  const notModified = items.filter((item) => item.fetchStatus === 'not-modified').length;
  console.log(
    `Built catalog with ${normalizedItems.length} item(s), ${guides.length} guide(s). `
    + `Ads: ${ads.enabled ? `on (${ads.publisherId})` : 'off'}. `
    + `Unchanged since last run (HTTP 304): ${notModified}.`,
  );
}

// Run `fn` over `items` with at most `limit` in flight, preserving input order
// in the returned results array.
async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;

  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await fn(items[index], index);
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// fetch() with a hard timeout and one retry. Without this a single hung OLX
// connection would stall the entire build (and the daily CI job) indefinitely.
async function fetchWithRetry(url, options = {}, { timeoutMs = 10000, retries = 1 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await delay(300 * (attempt + 1));
      }
    }
  }
  throw lastError;
}

// Guard against shipping a half-rendered page: any leftover {{PLACEHOLDER}} or
// (when we have links) a card-less grid means the template/data drifted.
function assertRenderedOutput(html, itemCount) {
  assertNoPlaceholders(html, 'index.html');
  if (itemCount > 0 && !html.includes('cam-card')) {
    throw new Error('Refusing to write index.html: expected camera cards but none were rendered.');
  }
}

// Shared by every templated page, so a new placeholder can never ship raw.
function assertNoPlaceholders(html, fileLabel) {
  const leftover = html.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (leftover) {
    const unique = [...new Set(leftover)].join(', ');
    throw new Error(`Refusing to write ${fileLabel}: unresolved placeholders (${unique}).`);
  }
}

function parseArgs(argv) {
  const parsed = {
    links: '',
    linksFile: '',
    writeLinksFile: false,
    strict: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--links') {
      parsed.links = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--links-file') {
      parsed.linksFile = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--write-links-file') {
      parsed.writeLinksFile = true;
    } else if (argument === '--strict') {
      // Opt-in: fail the run if any listing would ship as a placeholder card.
      // Off by default so one dead OLX link can't block the daily deploy.
      parsed.strict = true;
    }
  }

  return parsed;
}

function loadLinks(parsedArgs) {
  if (parsedArgs.links) {
    return normalizeLinks(parsedArgs.links);
  }

  if (parsedArgs.linksFile) {
    const customPath = path.resolve(process.cwd(), parsedArgs.linksFile);
    return normalizeLinks(fs.readFileSync(customPath, 'utf8'));
  }

  if (!fs.existsSync(LINKS_FILE)) {
    return [];
  }

  return normalizeLinks(fs.readFileSync(LINKS_FILE, 'utf8'));
}

function normalizeLinks(rawText) {
  const extractedLinks = rawText.match(/https?:\/\/[^\s;]+/gi) || [];
  return [...new Set(extractedLinks.map((entry) => entry.trim().replace(/[),]+$/g, '')).filter(Boolean))];
}

function todayInWarsaw() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(new Date());
}

// When a listing first showed up in the catalog, used for the NOWE badge.
//
// Listings already known before this field existed keep an empty firstSeen and
// are treated as not-new — otherwise the first build after adding the badge
// would stamp every camera in the catalog as a new arrival at once.
function resolveFirstSeen(url, previousMetadata, today) {
  const previous = previousMetadata.get(url);
  if (!previous) {
    return today;
  }
  return typeof previous.firstSeen === 'string' ? previous.firstSeen : '';
}

// A camera counts as a new arrival for NEW_ARRIVAL_DAYS after it first appeared.
function isNewArrival(item, today = todayInWarsaw()) {
  if (!item || !item.firstSeen || item.sold) {
    return false;
  }
  const first = Date.parse(`${item.firstSeen}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(now)) {
    return false;
  }
  const days = (now - first) / 86400000;
  return days >= 0 && days < NEW_ARRIVAL_DAYS;
}

function loadPreviousMetadata() {
  if (!fs.existsSync(OUTPUT_JSON)) {
    return new Map();
  }

  try {
    const data = JSON.parse(fs.readFileSync(OUTPUT_JSON, 'utf8'));
    if (!Array.isArray(data)) {
      return new Map();
    }

    return new Map(data.filter((item) => item && item.url).map((item) => [item.url, item]));
  } catch {
    return new Map();
  }
}

async function buildItem(url, fallbackItem) {
  try {
    // Conditional request: if we stored a validator last run, let OLX tell us
    // the listing is unchanged (304) instead of re-sending the whole page. Costs
    // nothing when OLX sends no validators — the headers are simply omitted and
    // every request stays a normal 200. Reduces load on OLX either way.
    const conditionalHeaders = {};
    if (fallbackItem?.etag) {
      conditionalHeaders['if-none-match'] = fallbackItem.etag;
    }
    if (fallbackItem?.lastModified) {
      conditionalHeaders['if-modified-since'] = fallbackItem.lastModified;
    }

    const response = await fetchWithRetry(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; StareAparatyBot/1.0; +https://github.com/110kc3/stare-aparaty)',
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
        ...conditionalHeaders,
      },
      redirect: 'follow',
    });

    // 304 Not Modified — the listing is byte-identical to what we already have,
    // so reuse it wholesale (including the sold state and price).
    if (response.status === 304 && fallbackItem) {
      return {
        title: fallbackItem.title,
        image: fallbackItem.image,
        url,
        host: new URL(url).hostname.replace(/^www\./, ''),
        sold: !!fallbackItem.sold,
        price: fallbackItem.price || '',
        oldPrice: fallbackItem.oldPrice || '',
        etag: fallbackItem.etag || '',
        lastModified: fallbackItem.lastModified || '',
        fetchStatus: 'not-modified',
      };
    }

    // OLX returns 410 (Gone) when a listing is permanently removed, which
    // almost always means the camera was sold. Mark the card so the template
    // can render a SPRZEDANE state instead of a broken click. A 404, by
    // contrast, can be a transient CDN hiccup, so we deliberately do NOT flip
    // to sold on it — it falls through to the !response.ok path below, which
    // preserves whatever sold state we already knew.
    if (response.status === 410) {
      console.warn(`Listing gone (HTTP ${response.status}) — marking sold: ${url}`);
      return {
        title: fallbackItem?.title || buildFallbackTitle(url),
        image: fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
        url,
        host: new URL(url).hostname.replace(/^www\./, ''),
        sold: true,
        price: fallbackItem?.price || '',
        oldPrice: fallbackItem?.oldPrice || '',
        // A gone listing will never validate again — drop the stale validators.
        etag: '',
        lastModified: '',
        fetchStatus: 'sold',
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const extracted = extractMetadata(html, url);
    const price = extracted.price || fallbackItem?.price || '';
    return {
      title: extracted.title || fallbackItem?.title || buildFallbackTitle(url),
      image: extracted.image || fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
      sold: false,
      price,
      oldPrice: resolveOldPrice(price, fallbackItem),
      etag: response.headers.get('etag') || '',
      lastModified: response.headers.get('last-modified') || '',
      // A 200 that yields no title/image means the page shape changed — the
      // card still renders, but from a placeholder, so flag it like a failure.
      fetchStatus: extracted.title && extracted.image ? 'ok' : 'placeholder',
    };
  } catch (error) {
    // Transient errors (timeout, DNS, etc.) shouldn't unset a previously-detected sold state.
    console.warn(`Falling back for ${url}: ${error.message}`);
    return {
      title: fallbackItem?.title || buildFallbackTitle(url),
      image: fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
      sold: !!fallbackItem?.sold,
      price: fallbackItem?.price || '',
      oldPrice: fallbackItem?.oldPrice || '',
      // Keep the validators so the next run can still ask conditionally.
      etag: fallbackItem?.etag || '',
      lastModified: fallbackItem?.lastModified || '',
      // Cached data is a soft landing; no cache means a placeholder card ships.
      fetchStatus: fallbackItem ? 'cached' : 'placeholder',
      fetchError: error.message,
    };
  }
}

// Group the run's fetch outcomes so the workflow can surface them. A placeholder
// card is the one that actually reaches visitors as a broken-looking entry, so
// it is reported separately from a listing that merely fell back to cache.
function summarizeFetchHealth(items) {
  const placeholders = items.filter((item) => item.fetchStatus === 'placeholder');
  const cached = items.filter((item) => item.fetchStatus === 'cached');
  return { placeholders, cached };
}

// GitHub Actions renders ::warning:: / ::error:: lines in the job summary and
// on the workflow run page, so a degraded listing is visible without digging
// through the log.
function reportFetchHealth({ placeholders, cached }, { strict = false, annotate = false } = {}) {
  const annotation = (level, message) => {
    if (annotate) {
      console.log(`::${level}::${message}`);
    } else {
      console.warn(`${level}: ${message}`);
    }
  };

  for (const item of cached) {
    annotation('warning', `Używam danych z cache dla ${item.url} (${item.fetchError || 'fetch failed'})`);
  }
  for (const item of placeholders) {
    annotation(strict ? 'error' : 'warning', `Karta zastępcza (brak danych i cache): ${item.url}`);
  }

  if (strict && placeholders.length > 0) {
    throw new Error(
      `${placeholders.length} listing(s) rendered as placeholder cards. Re-run, or remove them from product-links.txt.`,
    );
  }
}

function extractMetadata(html, pageUrl) {
  const title = getMetaContent(html, 'property', 'og:title')
    || getMetaContent(html, 'name', 'twitter:title')
    || extractJsonLdValue(html, ['name', 'headline'])
    || extractTitleTag(html);

  const image = getMetaContent(html, 'property', 'og:image')
    || getMetaContent(html, 'name', 'twitter:image')
    || extractJsonLdImage(html);

  return {
    title: cleanupText(title),
    image: absolutizeUrl(image, pageUrl),
    price: extractJsonLdPrice(html),
  };
}

function extractJsonLdPrice(html) {
  const jsonBlocks = getJsonLdBlocks(html);
  for (const block of jsonBlocks) {
    const offers = findFirstValue(block, ['offers']);
    if (!offers || typeof offers !== 'object') {
      continue;
    }
    const offer = Array.isArray(offers) ? offers[0] : offers;
    if (!offer || typeof offer !== 'object') {
      continue;
    }
    const amount = offer.price ?? offer.lowPrice;
    if (amount === undefined || amount === null || amount === '') {
      continue;
    }
    return formatPrice(amount, offer.priceCurrency || 'PLN');
  }
  return '';
}

function formatPrice(amount, currency) {
  // Strip whitespace thousands separators (incl. NBSP/thin space) and treat a
  // comma as the decimal point, so "1 234,56" parses instead of becoming NaN.
  const value = Number(String(amount).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  const formatted = new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
  return currency === 'PLN' ? `${formatted} zł` : `${formatted} ${currency}`;
}

// --- Old-price tracking ----------------------------------------------------

// Bare numeric value of a formatted price ("1 234,56 zł" -> 1234.56); 0 if none.
function priceNumber(formatted) {
  const n = Number(priceToNumber(formatted));
  return Number.isFinite(n) ? n : 0;
}

// Track a listing's all-time HIGH price and surface it as the struck-through
// "old" price only while the current price sits below that high — i.e. a
// genuine markdown. `currentPrice` is the freshly-fetched formatted price;
// `fallbackItem` is the listing's previous olx_meta.json snapshot, which carries
// forward both the last `price` and the last stored high in `oldPrice`. Returns
// the formatted old price to store/show, or '' when there is no active drop.
function resolveOldPrice(currentPrice, fallbackItem) {
  const curNum = priceNumber(currentPrice);
  // Unknown current price: don't recompute — keep whatever old price we had.
  if (curNum <= 0) return fallbackItem?.oldPrice || '';

  // Highest price seen so far = the larger of the last current and last high.
  let highStr = '';
  let highNum = 0;
  for (const candidate of [fallbackItem?.price, fallbackItem?.oldPrice]) {
    const n = priceNumber(candidate);
    if (n > highNum) {
      highNum = n;
      highStr = candidate;
    }
  }

  // Current is at/above the previous high -> it's a new high, nothing to strike.
  if (curNum >= highNum) return '';
  // Current sits below a previously seen higher price -> show that original high.
  return highStr;
}

function getMetaContent(html, attributeName, attributeValue) {
  // The content value only ends at a quote MATCHING the opening one, so an
  // apostrophe inside a double-quoted title ("Canon's AE-1") doesn't cut it off.
  const attributePart = `${attributeName}=["']${escapeRegex(attributeValue)}["']`;
  const contentPart = `content=(?:"([^"]+)"|'([^']+)')`;
  const pattern = new RegExp(`<meta[^>]*${attributePart}[^>]*${contentPart}[^>]*>`, 'i');
  const alternatePattern = new RegExp(`<meta[^>]*${contentPart}[^>]*${attributePart}[^>]*>`, 'i');
  const match = html.match(pattern) || html.match(alternatePattern);
  return decodeHtmlEntities(match ? (match[1] ?? match[2] ?? '') : '');
}

function extractTitleTag(html) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return decodeHtmlEntities(match ? match[1] : '');
}

function extractJsonLdImage(html) {
  const jsonBlocks = getJsonLdBlocks(html);
  for (const block of jsonBlocks) {
    const candidate = findFirstValue(block, ['image']);
    if (!candidate) {
      continue;
    }
    if (Array.isArray(candidate)) {
      const firstString = candidate.find((value) => typeof value === 'string');
      if (firstString) {
        return firstString;
      }
    }
    if (typeof candidate === 'string') {
      return candidate;
    }
    if (candidate && typeof candidate === 'object') {
      if (typeof candidate.url === 'string') {
        return candidate.url;
      }
      if (typeof candidate.contentUrl === 'string') {
        return candidate.contentUrl;
      }
    }
  }
  return '';
}

function extractJsonLdValue(html, keys) {
  const jsonBlocks = getJsonLdBlocks(html);
  for (const block of jsonBlocks) {
    const value = findFirstValue(block, keys);
    if (typeof value === 'string' && value.trim()) {
      return value;
    }
  }
  return '';
}

function getJsonLdBlocks(html) {
  const matches = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const values = [];
  for (const match of matches) {
    try {
      values.push(JSON.parse(match[1].trim()));
    } catch {
      continue;
    }
  }
  return values;
}

function findFirstValue(input, keys) {
  if (Array.isArray(input)) {
    for (const item of input) {
      const value = findFirstValue(item, keys);
      if (value) {
        return value;
      }
    }
    return '';
  }

  if (!input || typeof input !== 'object') {
    return '';
  }

  for (const key of keys) {
    const directValue = input[key];
    if (typeof directValue === 'string' && directValue.trim()) {
      return directValue;
    }
    if (Array.isArray(directValue) || (directValue && typeof directValue === 'object')) {
      return directValue;
    }
  }

  for (const nestedValue of Object.values(input)) {
    if (Array.isArray(nestedValue) || (nestedValue && typeof nestedValue === 'object')) {
      const value = findFirstValue(nestedValue, keys);
      if (value) {
        return value;
      }
    }
  }

  return '';
}

function buildFallbackTitle(url) {
  const parsed = new URL(url);
  const slug = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
  return slug.replace(/[-_]+/g, ' ').replace(/\.[a-z0-9]+$/i, '').trim();
}

function createPlaceholderImage(title) {
  const safeTitle = escapeXml((title || 'Oferta').slice(0, 48));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600"><rect width="800" height="600" fill="#d8c39d"/><rect x="40" y="40" width="720" height="520" fill="#f8e9c8" stroke="#11040f" stroke-width="12"/><text x="400" y="285" text-anchor="middle" font-family="monospace" font-size="34" fill="#261729">STARE APARATY</text><text x="400" y="340" text-anchor="middle" font-family="monospace" font-size="24" fill="#6f4f34">${safeTitle}</text></svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderIndex(items, adsConfig) {
  let rendered = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const ads = adsConfig || loadAdsConfig();

  const lastUpdated = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date());

  // Amazon/Allegro data is loaded up front because it feeds both the price
  // placeholders below and the film/accessory Product nodes in the JSON-LD.
  const amazon = loadAmazonProducts();
  const allegro = loadAllegroProducts();

  // split/join instead of String.replace: a listing title containing a `$&`,
  // `$'` or "$`" sequence would otherwise be expanded as a replacement pattern
  // and corrupt the page.
  rendered = rendered
    .split('{{COUNT}}').join(String(items.length))
    .split('{{LAST_UPDATED}}').join(escapeHtml(lastUpdated))
    .split('{{CAMERA_CARDS}}').join(renderCameraCatalog(items))
    .split('{{CAMERA_JSONLD}}').join(renderProductJsonLd(items, amazon.products, allegro.products))
    .split('{{ADSENSE_HEAD}}').join(renderAdsHead(ads))
    // A leaderboard between the catalog and the film sections, a card-shaped
    // unit that completes the colour-film row, and one above the footer.
    .split('{{AD_SLOT_MIDPAGE}}').join(renderAdUnit(ads, 'midpage', { className: 'ad-slot--wide' }))
    .split('{{AD_SLOT_INGRID}}').join(
      renderAdUnit(ads, 'ingrid', {
        className: 'ad-slot--card',
        format: 'fluid',
        fullWidthResponsive: false,
      }),
    )
    .split('{{AD_SLOT_FOOTER}}').join(renderAdUnit(ads, 'footer', { className: 'ad-slot--wide' }));

  // Inject Amazon prices + images (managed by scripts/amazon-products.json).
  for (const [asin, data] of Object.entries(amazon.products)) {
    rendered = rendered
      .split(`{{PRICE_${asin}}}`)
      .join(escapeHtml(data.price || ''));
    if (data.image) {
      rendered = rendered
        .split(`{{IMAGE_${asin}}}`)
        .join(escapeAttribute(data.image));
    }
  }

  // Inject Allegro prices + images (managed by scripts/allegro-products.json).
  // Same manual workflow as Amazon: edit the JSON, rebuild, the cards update.
  for (const [key, data] of Object.entries(allegro.products)) {
    rendered = rendered
      .split(`{{ALLEGRO_PRICE_${key}}}`)
      .join(escapeHtml(data.price || ''));
    if (data.image) {
      rendered = rendered
        .split(`{{ALLEGRO_IMAGE_${key}}}`)
        .join(escapeAttribute(data.image));
    }
  }

  // "Sprawdzone" date = the OLDEST lastChecked across BOTH marketplaces, so it
  // only advances once every displayed price (Amazon and Allegro) is current.
  const lastRefreshed = [amazon.lastRefreshed, allegro.lastRefreshed]
    .filter(Boolean)
    .sort()[0] || '';
  rendered = rendered
    .split('{{LAST_REFRESHED}}')
    .join(escapeHtml(lastRefreshed));

  return rendered;
}

// Emit schema.org structured data: a WebSite/Organization identity node, the
// camera catalog as an ItemList of Product/Offer nodes (sold listings
// advertise SoldOut, the rest InStock), and one Product per film/accessory
// card so the whole page — not just the OLX section — is machine-readable.
function renderProductJsonLd(items, amazonProducts = {}, allegroProducts = {}) {
  const organization = {
    '@type': 'Organization',
    name: 'Stare Aparaty',
    url: SITE_URL,
    logo: `${SITE_URL}icon-512.png`,
  };

  const graph = [
    {
      '@type': 'WebSite',
      name: 'Stare Aparaty',
      url: SITE_URL,
      inLanguage: 'pl-PL',
      description: 'Wybrane aparaty analogowe, filmy i akcesoria w spokojnym, filmowym klimacie.',
      publisher: organization,
    },
  ];

  if (items.length > 0) {
    graph.push({
      '@type': 'ItemList',
      name: 'Aparaty analogowe w ofercie',
      numberOfItems: items.length,
      itemListElement: items.map((item, index) => {
        const offer = {
          '@type': 'Offer',
          url: item.url,
          itemCondition: 'https://schema.org/UsedCondition',
          availability: item.sold
            ? 'https://schema.org/SoldOut'
            : 'https://schema.org/InStock',
        };
        const priceNumber = priceToNumber(item.price);
        if (priceNumber) {
          offer.price = priceNumber;
          offer.priceCurrency = 'PLN';
        }
        return {
          '@type': 'ListItem',
          position: index + 1,
          item: {
            '@type': 'Product',
            name: item.title,
            image: item.image,
            offers: offer,
          },
        };
      }),
    });
  }

  // Plain product URLs (no affiliate tag) go into the structured data; the
  // affiliate links stay in the visible cards only.
  for (const [asin, data] of Object.entries(amazonProducts)) {
    graph.push(retailProductNode(data, `https://www.amazon.pl/dp/${asin}`));
  }
  for (const data of Object.values(allegroProducts)) {
    graph.push(retailProductNode(data, data && data.url));
  }

  const wrapped = { '@context': 'https://schema.org', '@graph': graph.filter(Boolean) };
  // Escape "<" so a listing title can never break out of the <script> element.
  const json = JSON.stringify(wrapped, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n  </script>`;
}

// Product node for a film/accessory card sold new on Amazon/Allegro. Returns
// null for malformed entries so a bad JSON row degrades to "not in the graph"
// instead of a broken node.
function retailProductNode(data, url) {
  if (!data || !data.label || !url) {
    return null;
  }
  const offer = {
    '@type': 'Offer',
    url,
    itemCondition: 'https://schema.org/NewCondition',
    availability: 'https://schema.org/InStock',
  };
  const priceNumber = priceToNumber(data.price);
  if (priceNumber) {
    offer.price = priceNumber;
    offer.priceCurrency = 'PLN';
  }
  const product = {
    '@type': 'Product',
    name: data.label,
    offers: offer,
  };
  if (data.image) {
    product.image = data.image;
  }
  return product;
}

// llms-full.txt = the hand-written llms.txt prose with the live catalog inlined
// underneath, so an agent gets every camera, price and availability flag in one
// fetch instead of following a link into JSON.
//
// Generated rather than hand-written because the catalog is rebuilt daily: a
// static copy would be wrong within a day, and a confidently wrong price is
// worse than no file at all. The prose half is read from llms.txt so there is
// still only one place to edit it.
function renderLlmsFull(items) {
  const intro = fs.existsSync(LLMS_FILE)
    ? fs.readFileSync(LLMS_FILE, 'utf8').trimEnd()
    : '# Stare Aparaty';
  const available = items.filter((item) => !item.sold);
  const sold = items.filter((item) => item.sold);

  const line = (item) => {
    const price = item.price ? ` — ${item.price}` : '';
    const was = item.oldPrice ? ` (wczesniej ${item.oldPrice})` : '';
    return `- ${item.title}${price}${was} — ${item.url}`;
  };

  const sections = [
    intro,
    '',
    '## Pelny katalog aparatow',
    '',
    `Wygenerowane z olx_meta.json przy ostatnim buildzie. Dostepne: ${available.length}, sprzedane: ${sold.length}.`,
    '',
    '### Dostepne',
    '',
    available.length ? available.map(line).join('\n') : '- (brak dostepnych pozycji)',
  ];

  if (sold.length) {
    sections.push('', '### Sprzedane (archiwum)', '', sold.map(line).join('\n'));
  }

  return `${sections.join('\n')}\n`;
}

// The catalog is a single page, so the sitemap's job is mostly to carry an
// honest <lastmod> — it rebuilds daily with the catalog. The privacy policy is
// a hand-maintained static page, so it gets no <lastmod> rather than a false one.
function renderSitemap(guides) {
  const lastmod = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' })
    .format(new Date());
  // Guides carry a <lastmod> too: their offer lists rebuild with the catalog,
  // so the page really does change even when the prose doesn't.
  const guideEntries = (guides || loadGuides())
    .map((guide) => `  <url>
    <loc>${escapeXml(guide.url)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${guideEntries}
  <url>
    <loc>${SITE_URL}${PRIVACY_PATH}</loc>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>
</urlset>
`;
}

// ── Per-camera-type guides ─────────────────────────────────────────────────
// One short buyer's guide per catalog type, written in scripts/guides.json and
// rendered into poradniki/<slug>.html. Each page lists whichever cameras of its
// type are live on build day, so the guides double as an entry path into the
// OLX listings instead of being a dead-end wall of text.
function loadGuides() {
  if (!fs.existsSync(GUIDES_FILE)) {
    return [];
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(GUIDES_FILE, 'utf8'));
  } catch (error) {
    console.warn(`Could not read ${GUIDES_FILE}: ${error.message}`);
    return [];
  }
  return normalizeGuides(parsed.guides, loadTypeConfig());
}

// Validation lives here (not in the file read) so it is testable, and it is
// strict on purpose: a guide pointing at a renamed type would otherwise render
// a page that silently lists no cameras and loses its link from the catalog.
function normalizeGuides(guides, typeConfig) {
  const list = Array.isArray(guides) ? guides : [];
  const knownTypes = knownTypeSet(typeConfig);
  const seen = new Set();

  return list.map((guide) => {
    const slug = String(guide.slug || '').trim();
    // Also a path guard — the slug becomes a filename.
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new Error(`guides.json: "${slug}" is not a valid slug (lowercase letters, digits and dashes only).`);
    }
    if (seen.has(slug)) {
      throw new Error(`guides.json: duplicate slug "${slug}" — the second would overwrite the first.`);
    }
    seen.add(slug);

    const type = String(guide.type || '').trim();
    if (knownTypes.size > 0 && !knownTypes.has(type)) {
      throw new Error(
        `guides.json: guide "${slug}" targets type "${type}", which is not defined in camera-types.json.`,
      );
    }
    if (!guide.title || !guide.description) {
      throw new Error(`guides.json: guide "${slug}" needs both a title and a description.`);
    }

    // 'type' guides cover a whole catalog section and are what the homepage
    // headings link to. 'model' guides sit underneath one of them and select
    // their listings by keyword instead, so several can share a type.
    const kind = guide.kind === 'model' ? 'model' : 'type';
    const match = Array.isArray(guide.match) ? guide.match.filter(Boolean).map(String) : [];
    if (kind === 'model' && match.length === 0) {
      throw new Error(`guides.json: model guide "${slug}" needs a non-empty match list.`);
    }

    return {
      slug,
      type,
      kind,
      match,
      // Short label used in the cross-link row; a model guide can't use `type`
      // there because its siblings would all render the same text.
      navLabel: String(guide.navLabel || guide.type || guide.title),
      title: String(guide.title),
      description: String(guide.description),
      lead: String(guide.lead || ''),
      offersHeading: String(guide.offersHeading || `${type} w mojej ofercie`),
      sections: Array.isArray(guide.sections) ? guide.sections : [],
      url: `${SITE_URL}${GUIDES_DIR}/${slug}.html`,
    };
  });
}

// Which catalog listings a guide should show. A type guide takes its whole
// section; a model guide keyword-matches, so it stays useful after the specific
// body it was written about is sold and a similar one arrives.
function selectGuideListings(guide, items, typeConfig) {
  if (guide.kind === 'model') {
    return items.filter((item) => {
      const haystack = String(item.title).toLowerCase().trimStart();
      return guide.match.some((needle) => matchesNeedle(haystack, needle));
    });
  }
  return items.filter((item) => classifyType(item.title, typeConfig) === guide.type);
}

function knownTypeSet(typeConfig) {
  const types = new Set();
  for (const rule of (typeConfig && typeConfig.rules) || []) {
    if (rule && rule.type) types.add(rule.type);
  }
  for (const type of (typeConfig && typeConfig.order) || []) {
    types.add(type);
  }
  if (typeConfig && typeConfig.fallback) types.add(typeConfig.fallback);
  return types;
}

// Deliberately tiny: **bold** and *italic* only. The guide copy is prose in a
// JSON file, and anything richer belongs in the template, not in the data.
function renderInlineMarkup(text) {
  return escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function renderGuideBody(sections) {
  return sections
    .map((section) => {
      const parts = [`    <h2>${escapeHtml(section.heading || '')}</h2>`];
      for (const paragraph of section.paragraphs || []) {
        parts.push(`    <p>${renderInlineMarkup(paragraph)}</p>`);
      }
      if (Array.isArray(section.list) && section.list.length > 0) {
        const items = section.list
          .map((entry) => `      <li>${renderInlineMarkup(entry)}</li>`)
          .join('\n');
        parts.push(`    <ul>\n${items}\n    </ul>`);
      }
      return parts.join('\n');
    })
    .join('\n\n');
}

// A compact list rather than the catalog's photo cards: the guide is a text
// page, and reusing .cam-card would mean duplicating ~200 lines of grid CSS.
function renderGuideOffers(items) {
  if (items.length === 0) {
    return '    <p class="offers__empty">Aktualnie nie mam w ofercie aparatu tego typu — zajrzyj do '
      + '<a href="../#aparaty">pełnego katalogu</a>.</p>';
  }

  const rows = items
    .map((item) => {
      if (item.sold) {
        return '      <span class="offer offer--sold">'
          + `<span class="offer__name">${escapeHtml(item.title)}</span>`
          + '<span class="offer__price">sprzedane</span></span>';
      }
      const price = item.price ? escapeHtml(item.price) : 'zobacz na OLX';
      return `      <a class="offer" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">`
        + `<span class="offer__name">${escapeHtml(item.title)}</span>`
        + `<span class="offer__price">${price} →</span></a>`;
    })
    .join('\n');

  return `    <div class="offers">\n${rows}\n    </div>`;
}

function renderGuideRelated(guides, currentSlug) {
  const others = guides.filter((guide) => guide.slug !== currentSlug);
  if (others.length === 0) {
    return '      <a href="../#aparaty">Wróć do katalogu</a>';
  }
  return others
    .map((guide) => `      <a href="${escapeAttribute(`${guide.slug}.html`)}">${escapeHtml(guide.navLabel)}</a>`)
    .join('\n');
}

function renderGuideJsonLd(guide) {
  const graph = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: guide.title,
    description: guide.description,
    inLanguage: 'pl-PL',
    mainEntityOfPage: guide.url,
    author: { '@type': 'Organization', name: 'Stare Aparaty', url: SITE_URL },
    publisher: {
      '@type': 'Organization',
      name: 'Stare Aparaty',
      url: SITE_URL,
      logo: `${SITE_URL}icon-512.png`,
    },
  };
  return `<script type="application/ld+json">\n${JSON.stringify(graph, null, 2)}\n</script>`;
}

function renderGuide(guide, guides, items, adsConfig) {
  const ads = adsConfig || loadAdsConfig();
  const typeConfig = loadTypeConfig();
  const matching = selectGuideListings(guide, items, typeConfig);

  const rendered = fs.readFileSync(GUIDE_TEMPLATE_FILE, 'utf8')
    .split('{{GUIDE_TITLE}}').join(escapeHtml(guide.title))
    .split('{{GUIDE_DESCRIPTION}}').join(escapeAttribute(guide.description))
    .split('{{GUIDE_URL}}').join(escapeAttribute(guide.url))
    .split('{{GUIDE_LEAD}}').join(renderInlineMarkup(guide.lead))
    .split('{{GUIDE_BODY}}').join(renderGuideBody(guide.sections))
    .split('{{OFFERS_HEADING}}').join(escapeHtml(guide.offersHeading))
    .split('{{GUIDE_OFFERS}}').join(renderGuideOffers(matching))
    .split('{{GUIDE_RELATED}}').join(renderGuideRelated(guides, guide.slug))
    .split('{{GUIDE_JSONLD}}').join(renderGuideJsonLd(guide))
    .split('{{ADSENSE_HEAD}}').join(renderAdsHead(ads))
    .split('{{AD_SLOT_GUIDE}}').join(renderAdUnit(ads, 'guide', { className: 'ad-slot--wide' }));

  assertNoPlaceholders(rendered, `${GUIDES_DIR}/${guide.slug}.html`);
  return rendered;
}

function writeGuides(items, adsConfig) {
  const guides = loadGuides();
  if (guides.length === 0) {
    return guides;
  }
  fs.mkdirSync(OUTPUT_GUIDES_DIR, { recursive: true });
  for (const guide of guides) {
    const html = renderGuide(guide, guides, items, adsConfig);
    fs.writeFileSync(path.join(OUTPUT_GUIDES_DIR, `${guide.slug}.html`), html, 'utf8');
  }
  return guides;
}

// ── Google AdSense ─────────────────────────────────────────────────────────
// Ads are opt-in and driven entirely by scripts/ads-config.json. With
// enabled:false every ad placeholder renders as an empty string, so the page
// ships byte-for-byte ad-free and loads no third-party script — which is also
// what keeps the site consent-banner-free while Cloudflare's cookieless
// analytics is the only measurement in play.
function loadAdsConfig() {
  if (!fs.existsSync(ADS_CONFIG_FILE)) {
    return disabledAdsConfig();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ADS_CONFIG_FILE, 'utf8'));
  } catch (error) {
    // A malformed config file means ads simply don't render; it must never take
    // the daily catalog build down with it.
    console.warn(`Could not read ${ADS_CONFIG_FILE}: ${error.message}`);
    return disabledAdsConfig();
  }

  return normalizeAdsConfig(parsed);
}

function disabledAdsConfig() {
  return { enabled: false, publisherId: '', slots: {} };
}

// Split out from the file read so the validation rules are testable on their own.
function normalizeAdsConfig(parsed) {
  if (!parsed || parsed.enabled !== true) {
    return disabledAdsConfig();
  }

  // Past this point ads are meant to be live, so a malformed id is a hard
  // error: a typo'd publisher or slot id renders perfectly valid-looking HTML
  // that serves nothing, and the failure would otherwise be invisible for weeks.
  const publisherId = String(parsed.publisherId || '').trim();
  if (!/^ca-pub-\d{10,20}$/.test(publisherId)) {
    throw new Error(
      `ads-config.json: enabled is true but publisherId "${publisherId}" is not a ca-pub-<digits> value.`,
    );
  }

  const slots = {};
  for (const [name, rawId] of Object.entries(parsed.slots || {})) {
    const id = String(rawId || '').trim();
    if (!id) {
      // An empty slot is a deliberate "not created in AdSense yet" — skip it
      // and let Auto ads cover that spot instead of emitting a dead <ins>.
      continue;
    }
    if (!/^\d{6,20}$/.test(id)) {
      throw new Error(`ads-config.json: slot "${name}" id "${id}" is not a numeric AdSense slot id.`);
    }
    slots[name] = id;
  }

  return { enabled: true, publisherId, slots };
}

// The loader tag. This same script also fetches the Google-certified consent
// message configured under AdSense → Privacy & messaging, so there is no
// separate CMP snippet to keep in sync here.
function renderAdsHead(config) {
  if (!config || !config.enabled) {
    return '';
  }
  const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.publisherId)}`;
  return `  <!-- Google AdSense loader (also delivers the GDPR consent message) -->
  <script async src="${escapeAttribute(src)}" crossorigin="anonymous"></script>`;
}

// One display unit. Labelled "REKLAMA" because the in-grid placement sits among
// product cards that look exactly like editorial content — an unlabelled ad
// there would be genuinely misleading, and Google requires the distinction too.
function renderAdUnit(config, name, options = {}) {
  if (!config || !config.enabled) {
    return '';
  }
  const slot = config.slots[name];
  if (!slot) {
    return '';
  }

  const modifier = options.className ? ` ${options.className}` : '';
  const format = options.format || 'auto';
  const fullWidth = options.fullWidthResponsive === false ? 'false' : 'true';

  return `<aside class="ad-slot${modifier}">
    <span class="ad-slot__label">REKLAMA</span>
    <ins class="adsbygoogle ad-slot__ins"
         style="display:block"
         data-ad-client="${escapeAttribute(config.publisherId)}"
         data-ad-slot="${escapeAttribute(slot)}"
         data-ad-format="${escapeAttribute(format)}"
         data-full-width-responsive="${fullWidth}"></ins>
    <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
  </aside>`;
}

// The privacy policy is generated rather than hand-written so the publisher id
// lives in exactly one place (ads-config.json) and the "manage consent" button
// can only exist on a page that actually loads Google's CMP.
function renderPrivacyPolicy(adsConfig) {
  const ads = adsConfig || loadAdsConfig();
  const rendered = fs.readFileSync(PRIVACY_TEMPLATE_FILE, 'utf8')
    .split('{{PRIVACY_UPDATED}}').join(escapeHtml(PRIVACY_UPDATED))
    .split('{{ADSENSE_HEAD}}').join(renderAdsHead(ads))
    .split('{{CONSENT_REVOKE}}').join(renderConsentRevoke(ads));

  assertNoPlaceholders(rendered, PRIVACY_PATH);
  return rendered;
}

// Re-opens Google's consent message so a visitor can change their mind. Only
// meaningful when the AdSense loader (which supplies `googlefc`) is on the
// page, and the button stays hidden until the API confirms it can be shown —
// otherwise a user who clicked it would get nothing and assume it was broken.
function renderConsentRevoke(config) {
  if (!config || !config.enabled) {
    return '';
  }
  return `  <button type="button" class="consent-button" id="consent-revoke" hidden>Zmień swoje zgody na reklamy</button>
  <script>
    (function () {
      var button = document.getElementById('consent-revoke');
      if (!button) return;
      window.googlefc = window.googlefc || {};
      window.googlefc.callbackQueue = window.googlefc.callbackQueue || [];
      window.googlefc.callbackQueue.push({
        CONSENT_DATA_READY: function () {
          button.hidden = false;
          button.addEventListener('click', function () {
            window.googlefc.showRevocationMessage();
          });
        }
      });
    })();
  </script>`;
}

// ads.txt tells exchanges who may sell this domain's inventory. Google will not
// serve on a domain whose ads.txt is missing the matching pub- id, so this is
// generated from the same config as the tags rather than hand-maintained.
// Always writes a file (a comment-only one when ads are off) because both
// deploy workflows `cp ads.txt dist/` unconditionally.
function renderAdsTxt(config) {
  if (!config || !config.enabled) {
    return '# No ad network is authorized to sell inventory on this domain.\n';
  }
  // ads.txt wants the bare "pub-…" form, not the "ca-pub-…" tag attribute form.
  const sellerId = config.publisherId.replace(/^ca-/, '');
  return `google.com, ${sellerId}, DIRECT, f08c47fec0942fa0\n`;
}

// Pull a bare numeric value ("120", "1234.56") out of a formatted price like
// "120 zł" or "1 234,56 zł", for the JSON-LD price field. Returns '' if none.
function priceToNumber(formatted) {
  if (!formatted) {
    return '';
  }
  const match = String(formatted).replace(/\s/g, '').match(/\d+(?:[.,]\d{1,2})?/);
  return match ? match[0].replace(',', '.') : '';
}

function loadAmazonProducts() {
  if (!fs.existsSync(AMAZON_PRODUCTS_FILE)) {
    return { products: {}, lastRefreshed: '' };
  }
  try {
    const products = JSON.parse(fs.readFileSync(AMAZON_PRODUCTS_FILE, 'utf8'));
    // Oldest lastChecked across the catalog is the honest "as of" date.
    const dates = Object.values(products)
      .map((p) => p && p.lastChecked)
      .filter(Boolean)
      .sort();
    return { products, lastRefreshed: dates[0] || '' };
  } catch (error) {
    console.warn(`Could not read ${AMAZON_PRODUCTS_FILE}: ${error.message}`);
    return { products: {}, lastRefreshed: '' };
  }
}

function loadAllegroProducts() {
  if (!fs.existsSync(ALLEGRO_PRODUCTS_FILE)) {
    return { products: {}, lastRefreshed: '' };
  }
  try {
    const products = JSON.parse(fs.readFileSync(ALLEGRO_PRODUCTS_FILE, 'utf8'));
    // Oldest lastChecked across the Allegro cards is their honest "as of" date.
    const dates = Object.values(products)
      .map((p) => p && p.lastChecked)
      .filter(Boolean)
      .sort();
    return { products, lastRefreshed: dates[0] || '' };
  } catch (error) {
    console.warn(`Could not read ${ALLEGRO_PRODUCTS_FILE}: ${error.message}`);
    return { products: {}, lastRefreshed: '' };
  }
}

// One-sentence context per model (scripts/camera-notes.json). Reuses the same
// keyword-matching rules as the type classifier, so a `^` prefix anchors to the
// start of the title exactly as it does there.
function loadCameraNotes() {
  if (!fs.existsSync(CAMERA_NOTES_FILE)) {
    return [];
  }
  try {
    const config = JSON.parse(fs.readFileSync(CAMERA_NOTES_FILE, 'utf8'));
    return Array.isArray(config.rules) ? config.rules : [];
  } catch (error) {
    console.warn(`Could not read ${CAMERA_NOTES_FILE}: ${error.message}`);
    return [];
  }
}

function noteForTitle(title, rules) {
  const haystack = String(title).toLowerCase().trimStart();
  for (const rule of rules || []) {
    const needles = Array.isArray(rule.match) ? rule.match : [];
    if (needles.some((needle) => matchesNeedle(haystack, needle))) {
      return rule.note || '';
    }
  }
  return '';
}

function loadTypeConfig() {
  const fallbackConfig = { rules: [], fallback: 'Inne', order: [] };
  if (!fs.existsSync(CAMERA_TYPES_FILE)) {
    return fallbackConfig;
  }
  try {
    const config = JSON.parse(fs.readFileSync(CAMERA_TYPES_FILE, 'utf8'));
    return {
      rules: Array.isArray(config.rules) ? config.rules : [],
      fallback: config.fallback || 'Inne',
      order: Array.isArray(config.order) ? config.order : [],
    };
  } catch (error) {
    console.warn(`Could not read ${CAMERA_TYPES_FILE}: ${error.message}`);
    return fallbackConfig;
  }
}

// First matching keyword rule wins; otherwise the configured fallback type.
// A needle prefixed with "^" must match the START of the title rather than
// appear anywhere — this distinguishes a standalone "Obiektyw ..." (a lens)
// from a camera listed "... z obiektywem ..." (with a lens).
function classifyType(title, config) {
  const haystack = String(title).toLowerCase().trimStart();
  for (const rule of config.rules || []) {
    const needles = Array.isArray(rule.match) ? rule.match : [];
    if (needles.some((needle) => matchesNeedle(haystack, needle))) {
      return rule.type;
    }
  }
  return config.fallback;
}

function matchesNeedle(haystack, needle) {
  const n = String(needle).toLowerCase();
  return n.startsWith('^') ? haystack.startsWith(n.slice(1)) : haystack.includes(n);
}

// Bucket items by type, returning [type, items[]] pairs in the configured
// order. Non-empty buckets only; any type not named in `order` is appended in
// first-seen order so a newly added label still shows up.
function groupByType(items, config) {
  const buckets = new Map();
  for (const item of items) {
    const type = classifyType(item.title, config);
    if (!buckets.has(type)) {
      buckets.set(type, []);
    }
    buckets.get(type).push(item);
  }

  const ordered = [];
  const placed = new Set();
  for (const type of config.order || []) {
    if (buckets.has(type)) {
      ordered.push([type, buckets.get(type)]);
      placed.add(type);
    }
  }
  for (const [type, group] of buckets) {
    if (!placed.has(type)) {
      ordered.push([type, group]);
    }
  }
  return ordered;
}

// Render the camera section's inner markup. With a single (or zero) type the
// grid stays flat — no point in a lone heading. With several types, each gets a
// labelled sub-section so a long list reads as groups instead of one pile.
function renderCameraCatalog(items) {
  if (items.length === 0) {
    return '    <div class="camera-grid" aria-label="Katalog aparatów">\n'
      + '      <p style="flex:1;padding:24px;color:var(--ink-soft);text-align:center;">'
      + 'Brak ofert do wyświetlenia w tej chwili.</p>\n'
      + '    </div>';
  }

  const groups = groupByType(items, loadTypeConfig());

  // Loaded once for the whole catalog rather than per card — both are pure
  // lookups that every card would otherwise re-read from disk.
  const cardOptions = { noteRules: loadCameraNotes(), today: todayInWarsaw() };

  // A single global counter so only the first 4 images across the whole
  // catalog load eagerly (above-the-fold), regardless of grouping.
  let imageIndex = 0;
  const renderGroupCards = (group) =>
    group.map((item) => renderCard(item, imageIndex++, cardOptions)).join('\n');

  if (groups.length <= 1) {
    return '    <div class="camera-grid" aria-label="Katalog aparatów">'
      + `${renderGroupCards(groups[0][1])}\n    </div>`;
  }

  // Each type heading links to its buyer's guide when one exists — the guide is
  // the low-competition search entry point, and this is the only in-catalog
  // path to it. Model guides are excluded: several share a type, so they'd
  // fight over the one heading slot. They're reached from the type guide.
  const guidesByType = new Map(
    loadGuides()
      .filter((guide) => guide.kind === 'type')
      .map((guide) => [guide.type, guide]),
  );

  const sections = groups
    .map(([type, group]) => {
      const guide = guidesByType.get(type);
      const guideLink = guide
        ? `<a class="cam-group__guide" href="${escapeAttribute(`${GUIDES_DIR}/${guide.slug}.html`)}">Poradnik →</a>`
        : '';
      return '      <div class="cam-group">\n'
        + '        <div class="cam-group__head">'
        + `<span class="label">${escapeHtml(type)}</span>`
        + `<span class="cam-group__count">${group.length} szt.</span>${guideLink}</div>\n`
        + '        <div class="camera-grid">'
        + `${renderGroupCards(group)}\n        </div>\n`
        + '      </div>';
    })
    .join('\n');

  return `    <div class="camera-catalog" aria-label="Katalog aparatów">\n${sections}\n    </div>`;
}

function renderCard(item, index = 0, options = {}) {
  // First row (4 cards) loads eagerly for fast above-the-fold paint;
  // everything below lazy-loads.
  const loadingAttrs = index < 4 ? '' : ' loading="lazy" decoding="async"';
  const noteRules = options.noteRules || [];
  const note = noteForTitle(item.title, noteRules);
  const noteLine = note
    ? `\n              <p class="cam-card__note">${escapeHtml(note)}</p>`
    : '';
  const newChip = isNewArrival(item, options.today)
    ? '\n            <span class="cam-card__new">NOWE</span>'
    : '';
  // On a price drop, prefix the chip with the original (higher) price struck
  // through, so a markdown reads "390 zł 320 zł" at a glance.
  const oldPriceMark = item.oldPrice && !item.sold
    ? `<s class="cam-card__price-was">${escapeHtml(item.oldPrice)}</s> `
    : '';
  const priceChip = item.price && !item.sold
    ? `\n          <span class="cam-card__price">${oldPriceMark}${escapeHtml(item.price)}</span>`
    : '';

  // The card itself stays a single link to OLX (the conversion path). The zoom
  // button is a SIBLING of that link inside the shell — not nested in the <a>
  // (which would be invalid HTML) — so a click on it opens the lightbox without
  // navigating to OLX and without tripping the outbound-link tracker.
  const zoom = renderZoomButton(item);

  const card = item.sold
    ? `<div class="cam-card cam-card--sold" aria-label="Sprzedane">
          <div class="cam-card__img-wrap">
            <img class="cam-card__img"${loadingAttrs} src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}">
            <div class="cam-card__sold-badge"><span class="cam-card__sold-stamp">SPRZEDANE</span></div>
          </div>
          <div class="cam-card__strip">
            <div>
              <p class="cam-card__name">${escapeHtml(item.title)}</p>
              <p class="cam-card__detail">${escapeHtml(item.host)} · sprzedane</p>${noteLine}
            </div>
          </div>
        </div>`
    : `<a class="cam-card" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">
          <div class="cam-card__img-wrap">
            <img class="cam-card__img"${loadingAttrs} src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}">${priceChip}${newChip}
            <div class="cam-card__hover-cta"><span class="cam-card__cta-pill">OLX →</span></div>
          </div>
          <div class="cam-card__strip">
            <div>
              <p class="cam-card__name">${escapeHtml(item.title)}</p>
              <p class="cam-card__detail">${escapeHtml(item.host)}</p>${noteLine}
            </div>
          </div>
        </a>`;

  return `
      <div class="cam-card-shell">
        ${card}${zoom}
      </div>`;
}

// A magnifier button overlaid on the card image that opens the lightbox.
// Skipped for the generated SVG placeholder (nothing useful to enlarge).
function renderZoomButton(item) {
  if (!item.image || item.image.startsWith('data:')) {
    return '';
  }
  const icon = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">'
    + '<path fill="currentColor" d="M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z"/>'
    + '</svg>';
  return `
        <button type="button" class="cam-card__zoom" data-full="${escapeAttribute(item.image)}" aria-label="Powiększ zdjęcie: ${escapeAttribute(item.title)}">${icon}</button>`;
}

function absolutizeUrl(value, baseUrl) {
  if (!value) {
    return '';
  }
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function cleanupText(value) {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/\|\s*OLX.*$/i, '')
    .replace(/\s+-\s+OLX.*$/i, '')
    .replace(/\s+[•·]\s*OLX.*$/i, '')
    .trim();
}

function decodeHtmlEntities(value) {
  // &amp; is decoded last so a double-encoded entity (e.g. "&amp;lt;") becomes
  // "&lt;" rather than collapsing all the way to a raw "<".
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function escapeHtml(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/"/g, '&quot;');
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  formatPrice,
  getMetaContent,
  renderIndex,
  decodeHtmlEntities,
  priceToNumber,
  priceNumber,
  resolveOldPrice,
  cleanupText,
  normalizeLinks,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
  renderCard,
  escapeHtml,
  escapeAttribute,
  loadAllegroProducts,
  loadAdsConfig,
  normalizeAdsConfig,
  renderAdsHead,
  renderAdUnit,
  renderAdsTxt,
  renderSitemap,
  renderPrivacyPolicy,
  assertNoPlaceholders,
  loadGuides,
  normalizeGuides,
  renderGuide,
  renderGuideBody,
  renderGuideOffers,
  renderInlineMarkup,
  isNewArrival,
  resolveFirstSeen,
  noteForTitle,
  loadCameraNotes,
  summarizeFetchHealth,
  reportFetchHealth,
};
