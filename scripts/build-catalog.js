#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LINKS_FILE = path.join(ROOT_DIR, 'product-links.txt');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'index.template.html');
const AMAZON_PRODUCTS_FILE = path.join(__dirname, 'amazon-products.json');
const CAMERA_TYPES_FILE = path.join(__dirname, 'camera-types.json');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_JSON = path.join(ROOT_DIR, 'olx_meta.json');

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

  const normalizedItems = items.map((item, index) => ({
    id: index + 1,
    title: item.title,
    image: item.image,
    url: item.url,
    host: item.host,
    sold: !!item.sold,
    price: item.price || '',
  }));

  if (args.writeLinksFile) {
    fs.writeFileSync(LINKS_FILE, `${links.join('\n')}\n`, 'utf8');
  }

  const html = renderIndex(normalizedItems);
  assertRenderedOutput(html, normalizedItems.length);

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(normalizedItems, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');

  console.log(`Built catalog with ${normalizedItems.length} item(s).`);
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
  const leftover = html.match(/\{\{[A-Z0-9_]+\}\}/g);
  if (leftover) {
    const unique = [...new Set(leftover)].join(', ');
    throw new Error(`Refusing to write index.html: unresolved placeholders (${unique}).`);
  }
  if (itemCount > 0 && !html.includes('cam-card')) {
    throw new Error('Refusing to write index.html: expected camera cards but none were rendered.');
  }
}

function parseArgs(argv) {
  const parsed = {
    links: '',
    linksFile: '',
    writeLinksFile: false,
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
    const response = await fetchWithRetry(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; StareAparatyBot/1.0; +https://github.com/110kc3/stare-aparaty)',
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

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
      };
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const extracted = extractMetadata(html, url);
    return {
      title: extracted.title || fallbackItem?.title || buildFallbackTitle(url),
      image: extracted.image || fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
      sold: false,
      price: extracted.price || fallbackItem?.price || '',
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
    };
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

function getMetaContent(html, attributeName, attributeValue) {
  const pattern = new RegExp(`<meta[^>]*${attributeName}=["']${escapeRegex(attributeValue)}["'][^>]*content=["']([^"']+)["'][^>]*>`, 'i');
  const alternatePattern = new RegExp(`<meta[^>]*content=["']([^"']+)["'][^>]*${attributeName}=["']${escapeRegex(attributeValue)}["'][^>]*>`, 'i');
  return decodeHtmlEntities((html.match(pattern) || html.match(alternatePattern) || [])[1] || '');
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

function renderIndex(items) {
  let rendered = fs.readFileSync(TEMPLATE_FILE, 'utf8');

  const lastUpdated = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date());

  rendered = rendered
    .replace('{{COUNT}}', String(items.length))
    .replace('{{LAST_UPDATED}}', escapeHtml(lastUpdated))
    .replace('{{CAMERA_CARDS}}', renderCameraCatalog(items))
    .replace('{{CAMERA_JSONLD}}', renderProductJsonLd(items));

  // Inject Amazon prices + images (managed by scripts/refresh-amazon.js).
  const amazon = loadAmazonProducts();
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
  rendered = rendered
    .split('{{LAST_REFRESHED}}')
    .join(escapeHtml(amazon.lastRefreshed));

  return rendered;
}

// Emit schema.org Product/Offer structured data for the camera catalog so the
// listings are eligible for Google rich results. One JSON-LD graph holds every
// camera; sold listings advertise SoldOut, the rest InStock.
function renderProductJsonLd(items) {
  if (items.length === 0) {
    return '';
  }

  const products = items.map((item) => {
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
      '@type': 'Product',
      name: item.title,
      image: item.image,
      offers: offer,
    };
  });

  const graph = { '@context': 'https://schema.org', '@graph': products };
  // Escape "<" so a listing title can never break out of the <script> element.
  const json = JSON.stringify(graph, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n  </script>`;
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

  // A single global counter so only the first 4 images across the whole
  // catalog load eagerly (above-the-fold), regardless of grouping.
  let imageIndex = 0;
  const renderGroupCards = (group) =>
    group.map((item) => renderCard(item, imageIndex++)).join('\n');

  if (groups.length <= 1) {
    return '    <div class="camera-grid" aria-label="Katalog aparatów">'
      + `${renderGroupCards(groups[0][1])}\n    </div>`;
  }

  const sections = groups
    .map(([type, group]) =>
      '      <div class="cam-group">\n'
      + '        <div class="cam-group__head">'
      + `<span class="label">${escapeHtml(type)}</span>`
      + `<span class="cam-group__count">${group.length} szt.</span></div>\n`
      + '        <div class="camera-grid">'
      + `${renderGroupCards(group)}\n        </div>\n`
      + '      </div>')
    .join('\n');

  return `    <div class="camera-catalog" aria-label="Katalog aparatów">\n${sections}\n    </div>`;
}

function renderCard(item, index = 0) {
  // First row (4 cards) loads eagerly for fast above-the-fold paint;
  // everything below lazy-loads.
  const loadingAttrs = index < 4 ? '' : ' loading="lazy" decoding="async"';
  const priceChip = item.price && !item.sold
    ? `\n          <span class="cam-card__price">${escapeHtml(item.price)}</span>`
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
              <p class="cam-card__detail">${escapeHtml(item.host)} · sprzedane</p>
            </div>
          </div>
        </div>`
    : `<a class="cam-card" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">
          <div class="cam-card__img-wrap">
            <img class="cam-card__img"${loadingAttrs} src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}">${priceChip}
            <div class="cam-card__hover-cta"><span class="cam-card__cta-pill">OLX →</span></div>
          </div>
          <div class="cam-card__strip">
            <div>
              <p class="cam-card__name">${escapeHtml(item.title)}</p>
              <p class="cam-card__detail">${escapeHtml(item.host)}</p>
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
  decodeHtmlEntities,
  priceToNumber,
  cleanupText,
  normalizeLinks,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
  escapeHtml,
  escapeAttribute,
};
