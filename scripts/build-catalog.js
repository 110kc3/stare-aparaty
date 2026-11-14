#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT_DIR = path.resolve(__dirname, '..');
const LINKS_FILE = path.join(ROOT_DIR, 'product-links.txt');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'index.template.html');
const PRIVACY_TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'privacy.template.html');
const GUIDE_TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'guide.template.html');
const GUIDES_FILE = path.join(__dirname, 'guides.json');
const ALLEGRO_PRODUCTS_FILE = path.join(__dirname, 'allegro-products.json');
const ALLEGRO_CAMPAIGN_ID = '8902aaa9-6bd4-43f8-8111-28eb4c6a3dde';
const CAMERA_TYPES_FILE = path.join(__dirname, 'camera-types.json');
const CAMERA_NOTES_FILE = path.join(__dirname, 'camera-notes.json');
const NEW_ARRIVAL_DAYS = 14;
const ADS_CONFIG_FILE = path.join(__dirname, 'ads-config.json');
const PAGE_STATE_FILE = path.join(__dirname, 'page-state.json');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_JSON = path.join(ROOT_DIR, 'olx_meta.json');
const OUTPUT_SITEMAP = path.join(ROOT_DIR, 'sitemap.xml');
const LLMS_TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'llms.template.txt');
const OUTPUT_LLMS = path.join(ROOT_DIR, 'llms.txt');
const OUTPUT_LLMS_FULL = path.join(ROOT_DIR, 'llms-full.txt');
const OUTPUT_ADS_TXT = path.join(ROOT_DIR, 'ads.txt');

const SITE_URL = 'https://stareaparaty.com/';
const PRIVACY_PATH = 'polityka-prywatnosci.html';
const OUTPUT_PRIVACY = path.join(ROOT_DIR, PRIVACY_PATH);
const PRIVACY_UPDATED = '13 października 2026';
const GUIDES_DIR = 'poradniki';
const OUTPUT_GUIDES_DIR = path.join(ROOT_DIR, GUIDES_DIR);

const FETCH_CONCURRENCY = 5;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const links = loadLinks(args);
  const previousMetadata = loadPreviousMetadata();

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
    etag: item.etag || '',
    lastModified: item.lastModified || '',
  }));

  reportFetchHealth(summarizeFetchHealth(items), {
    strict: args.strict,
    annotate: !!process.env.GITHUB_ACTIONS,
  });

  reportPriceFreshness(
    summarizePriceFreshness(
      [
        { name: 'allegro', products: loadAllegroProducts().products },
      ],
      today,
    ),
    { annotate: !!process.env.GITHUB_ACTIONS },
  );

  if (args.writeLinksFile) {
    fs.writeFileSync(LINKS_FILE, `${links.join('\n')}\n`, 'utf8');
  }

  const ads = loadAdsConfig();

  const html = renderIndex(normalizedItems, ads);
  assertRenderedOutput(html, normalizedItems.length);

  const privacyHtml = renderPrivacyPolicy(ads);
  const guidePages = writeGuides(normalizedItems, ads);
  const guides = guidePages.map((page) => page.guide);

  const { lastmod, state } = resolvePageLastmod(
    [
      { url: SITE_URL, html },
      ...guidePages.map((page) => ({ url: page.guide.url, html: page.html })),
      { url: `${SITE_URL}${PRIVACY_PATH}`, html: privacyHtml },
    ],
    loadPageState(),
    today,
  );

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(normalizedItems, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_HTML, html, 'utf8');
  fs.writeFileSync(OUTPUT_PRIVACY, privacyHtml, 'utf8');
  fs.writeFileSync(PAGE_STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_SITEMAP, renderSitemap(guides, lastmod), 'utf8');
  fs.writeFileSync(OUTPUT_ADS_TXT, renderAdsTxt(ads), 'utf8');

  const llmsIntro = renderLlmsTxt(guides, ads);
  fs.writeFileSync(OUTPUT_LLMS, llmsIntro, 'utf8');
  fs.writeFileSync(OUTPUT_LLMS_FULL, renderLlmsFull(normalizedItems, llmsIntro), 'utf8');

  const notModified = items.filter((item) => item.fetchStatus === 'not-modified').length;
  console.log(
    `Built catalog with ${normalizedItems.length} item(s), ${guides.length} guide(s). `
    + `Ads: ${ads.enabled ? `on (${ads.publisherId})` : 'off'}. `
    + `Unchanged since last run (HTTP 304): ${notModified}.`,
  );
}

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

function assertRenderedOutput(html, itemCount) {
  assertNoPlaceholders(html, 'index.html');
  if (itemCount > 0 && !html.includes('cam-card')) {
    throw new Error('Refusing to write index.html: expected camera cards but none were rendered.');
  }
}

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

function todayInWarsaw(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Warsaw',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function resolveFirstSeen(url, previousMetadata, today) {
  const previous = previousMetadata.get(url);
  if (!previous) {
    return today;
  }
  return typeof previous.firstSeen === 'string' ? previous.firstSeen : '';
}

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
      fetchStatus: extracted.title && extracted.image ? 'ok' : 'placeholder',
    };
  } catch (error) {
    console.warn(`Falling back for ${url}: ${error.message}`);
    return {
      title: fallbackItem?.title || buildFallbackTitle(url),
      image: fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
      sold: !!fallbackItem?.sold,
      price: fallbackItem?.price || '',
      oldPrice: fallbackItem?.oldPrice || '',
      etag: fallbackItem?.etag || '',
      lastModified: fallbackItem?.lastModified || '',
      fetchStatus: fallbackItem ? 'cached' : 'placeholder',
      fetchError: error.message,
    };
  }
}

function summarizeFetchHealth(items) {
  const placeholders = items.filter((item) => item.fetchStatus === 'placeholder');
  const cached = items.filter((item) => item.fetchStatus === 'cached');
  return { placeholders, cached };
}

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
  const value = Number(String(amount).replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0) {
    return '';
  }
  const formatted = new Intl.NumberFormat('pl-PL', {
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2,
  }).format(value);
  return currency === 'PLN' ? `${formatted} zł` : `${formatted} ${currency}`;
}


function priceNumber(formatted) {
  const n = Number(priceToNumber(formatted));
  return Number.isFinite(n) ? n : 0;
}

function resolveOldPrice(currentPrice, fallbackItem) {
  const curNum = priceNumber(currentPrice);
  if (curNum <= 0) return fallbackItem?.oldPrice || '';

  let highStr = '';
  let highNum = 0;
  for (const candidate of [fallbackItem?.price, fallbackItem?.oldPrice]) {
    const n = priceNumber(candidate);
    if (n > highNum) {
      highNum = n;
      highStr = candidate;
    }
  }

  if (curNum >= highNum) return '';
  return highStr;
}

function getMetaContent(html, attributeName, attributeValue) {
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

  const allegro = loadAllegroProducts();

  rendered = rendered
    .split('{{COUNT}}').join(String(items.length))
    .split('{{LAST_UPDATED}}').join(escapeHtml(lastUpdated))
    .split('{{CAMERA_CARDS}}').join(renderCameraCatalog(items))
    .split('{{SITE_JSONLD}}').join(renderSiteJsonLd(items))
    .split('{{ADSENSE_HEAD}}').join(renderAdsHead(ads))
    .split('{{ADS_DISCLOSURE}}').join(ads.enabled ? ' Strona wyświetla też reklamy Google.' : '')
    .split('{{AD_SLOT_MIDPAGE}}').join(renderAdUnit(ads, 'midpage', { className: 'ad-slot--wide' }))
    .split('{{AD_SLOT_INGRID}}').join(
      renderAdUnit(ads, 'ingrid', {
        className: 'ad-slot--card',
        format: 'fluid',
        fullWidthResponsive: false,
      }),
    )
    .split('{{AD_SLOT_FOOTER}}').join(renderAdUnit(ads, 'footer', { className: 'ad-slot--wide' }));

  for (const [key, data] of Object.entries(allegro.products)) {
    rendered = rendered
      .split(`{{ALLEGRO_URL_${key}}}`)
      .join(escapeAttribute(buildAllegroAffiliateUrl(data.url)))
      .split(`{{ALLEGRO_PRICE_${key}}}`)
      .join(escapeHtml(data.available === false ? 'Obecnie niedostępny' : data.price || ''));
    if (data.image) {
      rendered = rendered
        .split(`{{ALLEGRO_IMAGE_${key}}}`)
        .join(escapeAttribute(data.image));
    }
  }

  rendered = rendered
    .split('{{LAST_REFRESHED}}')
    .join(escapeHtml(allegro.lastRefreshed));

  return rendered;
}

function renderSiteJsonLd(items) {
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
      itemListElement: items.map((item, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@id': item.url,
          name: item.title,
          image: item.image,
        },
      })),
    });
  }

  const wrapped = { '@context': 'https://schema.org', '@graph': graph };
  const json = JSON.stringify(wrapped, null, 2).replace(/</g, '\\u003c');
  return `<script type="application/ld+json">\n${json}\n  </script>`;
}

function renderLlmsTxt(guides, adsConfig) {
  const ads = adsConfig || loadAdsConfig();
  const list = guides || loadGuides();

  const guidePages = list
    .map((guide) => `- ${guide.url} — ${guide.llms}`)
    .join('\n');

  const adsNote = ads.enabled
    ? '- The page carries Google AdSense display advertising. Ad units are marked "REKLAMA" and are not part of the '
      + 'curated catalog — do not treat their content as a recommendation by this site.'
    : '- The site currently displays no advertising and sets no cookies of its own; the visit statistics named in the '
      + 'privacy policy are collected without cookies, which is why there is no consent banner.';

  const rendered = fs.readFileSync(LLMS_TEMPLATE_FILE, 'utf8')
    .split('{{GUIDE_PAGES}}').join(guidePages)
    .split('{{ADS_NOTE}}').join(adsNote);

  assertNoPlaceholders(rendered, 'llms.txt');
  return rendered;
}

function renderLlmsFull(items, intro) {
  const header = (intro || renderLlmsTxt()).trimEnd();
  const available = items.filter((item) => !item.sold);
  const sold = items.filter((item) => item.sold);

  const line = (item) => {
    const price = item.price ? ` — ${item.price}` : '';
    const was = item.oldPrice ? ` (wczesniej ${item.oldPrice})` : '';
    return `- ${item.title}${price}${was} — ${item.url}`;
  };

  const sections = [
    header,
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

const VOLATILE_MARKUP = [
  /(<span class="label label--soft">Aktualizacja: )[^<]*(<\/span>)/g,
];

function contentFingerprint(html) {
  let stable = html == null ? '' : String(html);
  for (const pattern of VOLATILE_MARKUP) {
    stable = stable.replace(pattern, '$1$2');
  }
  return crypto.createHash('sha256').update(stable).digest('hex').slice(0, 16);
}

function loadPageState() {
  if (!fs.existsSync(PAGE_STATE_FILE)) {
    return {};
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(PAGE_STATE_FILE, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (error) {
    console.warn(`Could not read ${PAGE_STATE_FILE}: ${error.message}`);
    return {};
  }
}

function resolvePageLastmod(pages, previousState, today) {
  const previous = previousState || {};
  const lastmod = new Map();
  const state = {};

  for (const page of pages) {
    const fingerprint = contentFingerprint(page.html);
    const known = previous[page.url];
    const unchanged = !!known && known.fingerprint === fingerprint && !!known.lastmod;
    const date = unchanged ? known.lastmod : today;
    state[page.url] = { fingerprint, lastmod: date };
    lastmod.set(page.url, date);
  }

  return { lastmod, state };
}

function renderSitemap(guides, lastmod = new Map()) {
  const dateElement = (url, indent = '    ') => (
    lastmod.get(url) ? `\n${indent}<lastmod>${escapeXml(lastmod.get(url))}</lastmod>` : ''
  );
  const privacyUrl = `${SITE_URL}${PRIVACY_PATH}`;

  const guideEntries = (guides || loadGuides())
    .map((guide) => `  <url>
    <loc>${escapeXml(guide.url)}</loc>${dateElement(guide.url)}
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${SITE_URL}</loc>${dateElement(SITE_URL)}
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>
${guideEntries}
  <url>
    <loc>${privacyUrl}</loc>${dateElement(privacyUrl)}
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>
</urlset>
`;
}

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

function normalizeGuides(guides, typeConfig) {
  const list = Array.isArray(guides) ? guides : [];
  const knownTypes = knownTypeSet(typeConfig);
  const seen = new Set();

  return list.map((guide) => {
    const slug = String(guide.slug || '').trim();
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
      navLabel: String(guide.navLabel || guide.type || guide.title),
      title: String(guide.title),
      description: String(guide.description),
      llms: String(guide.llms || guide.description),
      lead: String(guide.lead || ''),
      offersHeading: String(guide.offersHeading || `${type} w mojej ofercie`),
      sections: Array.isArray(guide.sections) ? guide.sections : [],
      url: `${SITE_URL}${GUIDES_DIR}/${slug}.html`,
    };
  });
}

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
    return [];
  }
  fs.mkdirSync(OUTPUT_GUIDES_DIR, { recursive: true });
  return guides.map((guide) => {
    const html = renderGuide(guide, guides, items, adsConfig);
    fs.writeFileSync(path.join(OUTPUT_GUIDES_DIR, `${guide.slug}.html`), html, 'utf8');
    return { guide, html };
  });
}

function loadAdsConfig() {
  if (!fs.existsSync(ADS_CONFIG_FILE)) {
    return disabledAdsConfig();
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(ADS_CONFIG_FILE, 'utf8'));
  } catch (error) {
    console.warn(`Could not read ${ADS_CONFIG_FILE}: ${error.message}`);
    return disabledAdsConfig();
  }

  return normalizeAdsConfig(parsed);
}

function disabledAdsConfig() {
  return { enabled: false, publisherId: '', slots: {} };
}

function normalizeAdsConfig(parsed) {
  if (!parsed || parsed.enabled !== true) {
    return disabledAdsConfig();
  }

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
      continue;
    }
    if (!/^\d{6,20}$/.test(id)) {
      throw new Error(`ads-config.json: slot "${name}" id "${id}" is not a numeric AdSense slot id.`);
    }
    slots[name] = id;
  }

  return { enabled: true, publisherId, slots };
}

function renderAdsHead(config) {
  if (!config || !config.enabled) {
    return '';
  }
  const src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.publisherId)}`;
  return `  <!-- Google AdSense loader (also delivers the GDPR consent message) -->
  <script async src="${escapeAttribute(src)}" crossorigin="anonymous"></script>`;
}

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

function renderPrivacyPolicy(adsConfig) {
  const ads = adsConfig || loadAdsConfig();
  const rendered = fs.readFileSync(PRIVACY_TEMPLATE_FILE, 'utf8')
    .split('{{PRIVACY_UPDATED}}').join(escapeHtml(PRIVACY_UPDATED))
    .split('{{ADSENSE_HEAD}}').join(renderAdsHead(ads))
    .split('{{ADS_DATA_BULLET}}').join(renderAdsDataBullet(ads))
    .split('{{ADS_SECTION}}').join(renderAdsPolicySection(ads))
    .split('{{LEGAL_BASIS_ITEMS}}').join(renderLegalBasisItems(ads))
    .split('{{COOKIE_BROWSER_NOTE}}').join(renderCookieBrowserNote(ads))
    .split('{{CONSENT_REVOKE}}').join(renderConsentRevoke(ads));

  assertNoPlaceholders(rendered, PRIVACY_PATH);
  return rendered;
}

function renderAdsDataBullet(config) {
  if (!config || !config.enabled) {
    return '';
  }
  return '    <li><strong>Dane reklamowe</strong> — zbierane przez Google w związku z wyświetlaniem reklam (patrz punkt 3).</li>';
}

function renderAdsPolicySection(config) {
  if (!config || !config.enabled) {
    return `  <h2>3. Reklamy i pliki cookie</h2>
  <p>Serwis <strong>nie wyświetla obecnie reklam</strong> i <strong>nie zapisuje na Twoim urządzeniu żadnych plików cookie</strong>. Nie działa tu żaden mechanizm profilowania ani identyfikator reklamowy. Statystyki opisane w punkcie 2 zbierane są bez plików cookie — dlatego serwis nie wyświetla komunikatu zgody na cookie.</p>
  <p>Jeżeli reklamy zostaną w przyszłości uruchomione, przed ich włączeniem pojawi się certyfikowany komunikat zgody, a ta polityka zostanie zaktualizowana wraz z datą widniejącą na górze strony.</p>`;
  }

  return `  <h2>3. Reklamy Google i pliki cookie</h2>
  <p>Serwis wyświetla reklamy za pośrednictwem <strong>Google AdSense</strong>. W związku z tym Google i jego partnerzy mogą zapisywać na Twoim urządzeniu pliki cookie oraz odczytywać identyfikatory reklamowe, aby:</p>
  <ul>
    <li>wyświetlać reklamy dopasowane do Twoich zainteresowań (reklamy spersonalizowane) — <strong>wyłącznie za Twoją zgodą</strong>;</li>
    <li>mierzyć skuteczność reklam i ograniczać liczbę wyświetleń tej samej reklamy;</li>
    <li>wykrywać nadużycia i nieprawidłowy ruch.</li>
  </ul>
  <p>Przy pierwszej wizycie zobaczysz komunikat zgody (certyfikowany przez Google mechanizm CMP zgodny ze standardem IAB TCF). Jeżeli nie wyrazisz zgody, reklamy nadal będą się wyświetlać, ale w wersji <strong>niespersonalizowanej</strong> — dobieranej na podstawie treści strony, a nie Twojego profilu.</p>
  <p>Google występuje tu jako niezależny administrator swoich danych. Szczegóły opisuje <a href="https://policies.google.com/technologies/partner-sites" target="_blank" rel="noopener">polityka Google dotycząca danych z witryn partnerskich</a>. Swoje ustawienia reklam w Google zmienisz na <a href="https://myadcenter.google.com/" target="_blank" rel="noopener">myadcenter.google.com</a>.</p>`;
}

function renderLegalBasisItems(config) {
  const legitimateInterest = config && config.enabled
    ? 'prowadzenie zagregowanych statystyk odwiedzin, wyświetlanie reklam niespersonalizowanych, zapewnienie bezpieczeństwa serwisu, odpowiedź na korespondencję'
    : 'prowadzenie zagregowanych statystyk odwiedzin, zapewnienie bezpieczeństwa serwisu, odpowiedź na korespondencję';

  const items = [];
  if (config && config.enabled) {
    items.push('    <li><strong>Zgoda</strong> (art. 6 ust. 1 lit. a RODO) — reklamy spersonalizowane i związane z nimi pliki cookie.</li>');
  }
  items.push(`    <li><strong>Prawnie uzasadniony interes</strong> (art. 6 ust. 1 lit. f RODO) — ${legitimateInterest}.</li>`);
  return items.join('\n');
}

function renderCookieBrowserNote(config) {
  if (!config || !config.enabled) {
    return '  <p>Serwis nie zapisuje własnych plików cookie, więc nie ma tu czym zarządzać. Własne pliki cookie mogą natomiast zapisać serwisy, do których prowadzą odnośniki (OLX, Allegro) — już po przejściu na ich strony. W ustawieniach przeglądarki możesz w każdej chwili zablokować lub usunąć pliki cookie; nie ograniczy to dostępu do treści tego serwisu.</p>';
  }
  return '  <p>Niezależnie od komunikatu zgody możesz w każdej chwili zablokować lub usunąć pliki cookie w ustawieniach przeglądarki. Blokada plików cookie nie ogranicza dostępu do treści tego serwisu — wpłynie jedynie na sposób doboru reklam.</p>';
}

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

function renderAdsTxt(config) {
  if (!config || !config.enabled) {
    return '# No ad network is authorized to sell inventory on this domain.\n';
  }
  const sellerId = config.publisherId.replace(/^ca-/, '');
  return `google.com, ${sellerId}, DIRECT, f08c47fec0942fa0\n`;
}

function priceToNumber(formatted) {
  if (!formatted) {
    return '';
  }
  const match = String(formatted).replace(/\s/g, '').match(/\d+(?:[.,]\d{1,2})?/);
  return match ? match[0].replace(',', '.') : '';
}

const PRICE_STALE_DAYS = 30;

function daysBetween(fromIsoDate, toIsoDate) {
  const from = Date.parse(fromIsoDate);
  const to = Date.parse(toIsoDate);
  if (Number.isNaN(from) || Number.isNaN(to)) {
    return null;
  }
  return Math.floor((to - from) / 86400000);
}

function summarizePriceFreshness(marketplaces, today, staleDays = PRICE_STALE_DAYS) {
  const entries = [];
  for (const marketplace of marketplaces) {
    for (const [key, data] of Object.entries(marketplace.products || {})) {
      entries.push({
        marketplace: marketplace.name,
        key,
        label: (data && data.label) || key,
        lastChecked: (data && data.lastChecked) || '',
        ageDays: data && data.lastChecked ? daysBetween(data.lastChecked, today) : null,
      });
    }
  }

  const undated = entries.filter((entry) => !entry.lastChecked);
  const dated = entries.filter((entry) => entry.lastChecked);
  const stale = dated
    .filter((entry) => entry.ageDays !== null && entry.ageDays > staleDays)
    .sort((a, b) => b.ageDays - a.ageDays);

  const published = dated.map((entry) => entry.lastChecked).sort()[0] || '';
  const laggards = dated.filter((entry) => entry.lastChecked === published);
  const nextDate = [...new Set(dated.map((entry) => entry.lastChecked))].sort()[1] || '';

  return { entries, stale, undated, published, laggards, nextDate };
}

function reportPriceFreshness(summary, { annotate = false } = {}) {
  const warn = (message) => {
    if (annotate) {
      console.log(`::warning::${message}`);
    } else {
      console.warn(`warning: ${message}`);
    }
  };

  for (const entry of summary.undated) {
    warn(`Cena bez daty sprawdzenia: ${entry.marketplace}/${entry.key} (${entry.label}) `
      + '— nie wchodzi do daty w stopce, więc może być dowolnie stara.');
  }

  const dated = summary.entries.filter((entry) => entry.lastChecked);
  if (summary.stale.length > 0 && summary.stale.length === dated.length) {
    const newest = dated.map((entry) => entry.lastChecked).sort().pop();
    warn(`Wszystkie ${dated.length} cen jest nieodświeżanych od ponad ${PRICE_STALE_DAYS} dni `
      + `(najstarsza ${summary.published}, najnowsza ${newest}). `
      + 'Odśwież scripts/allegro-products.json.');
  } else {
    const listed = summary.stale.slice(0, 5);
    for (const entry of listed) {
      warn(`Cena nieodświeżana ${entry.ageDays} dni: ${entry.marketplace}/${entry.key} `
        + `(${entry.label}, ${entry.lastChecked}).`);
    }
    if (summary.stale.length > listed.length) {
      warn(`…oraz ${summary.stale.length - listed.length} kolejnych pozycji z ceną starszą `
        + `niż ${PRICE_STALE_DAYS} dni.`);
    }
  }

  if (summary.nextDate && summary.laggards.length > 0) {
    const names = summary.laggards.map((entry) => `${entry.marketplace}/${entry.key}`).join(', ');
    const action = summary.laggards.length === 1
      ? 'Odświeżenie tej jednej pozycji przesunie ją'
      : `Odświeżenie tych ${summary.laggards.length} pozycji przesunie ją`;
    warn(`Data w stopce (${summary.published}) jest ustawiana przez: ${names}. `
      + `${action} na ${summary.nextDate}.`);
  }
}

function buildAllegroAffiliateUrl(rawUrl) {
  const destination = new URL(rawUrl);
  const retail = (destination.hostname === 'allegro.pl' && destination.pathname.startsWith('/produkt/'))
    || (destination.hostname === 'business.allegro.pl' && destination.pathname.startsWith('/oferta/'));
  if (destination.protocol !== 'https:' || !retail || destination.username || destination.password) {
    throw new Error(`Expected an Allegro retail product URL: ${rawUrl}`);
  }
  destination.searchParams.set('utm_medium', 'afiliacja');
  destination.searchParams.set('utm_source', 'ctr_b');
  destination.searchParams.set('utm_campaign', ALLEGRO_CAMPAIGN_ID);
  const affiliate = new URL('https://allegro.pl/affiliate');
  affiliate.searchParams.set('redirect_url', destination.href);
  return affiliate.href;
}

function loadAllegroProducts() {
  if (!fs.existsSync(ALLEGRO_PRODUCTS_FILE)) {
    return { products: {}, lastRefreshed: '' };
  }
  try {
    const products = JSON.parse(fs.readFileSync(ALLEGRO_PRODUCTS_FILE, 'utf8'));
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

function renderCameraCatalog(items) {
  if (items.length === 0) {
    return '    <div class="camera-grid" aria-label="Katalog aparatów">\n'
      + '      <p style="flex:1;padding:24px;color:var(--ink-soft);text-align:center;">'
      + 'Brak ofert do wyświetlenia w tej chwili.</p>\n'
      + '    </div>';
  }

  const groups = groupByType(items, loadTypeConfig());

  const cardOptions = { noteRules: loadCameraNotes(), today: todayInWarsaw() };

  let imageIndex = 0;
  const renderGroupCards = (group) =>
    group.map((item) => renderCard(item, imageIndex++, cardOptions)).join('\n');

  if (groups.length <= 1) {
    return '    <div class="camera-grid" aria-label="Katalog aparatów">'
      + `${renderGroupCards(groups[0][1])}\n    </div>`;
  }

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
  const loadingAttrs = index < 4 ? '' : ' loading="lazy" decoding="async"';
  const noteRules = options.noteRules || [];
  const note = noteForTitle(item.title, noteRules);
  const noteLine = note
    ? `\n              <p class="cam-card__note">${escapeHtml(note)}</p>`
    : '';
  const newChip = isNewArrival(item, options.today)
    ? '\n            <span class="cam-card__new">NOWE</span>'
    : '';
  const oldPriceMark = item.oldPrice && !item.sold
    ? `<s class="cam-card__price-was">${escapeHtml(item.oldPrice)}</s> `
    : '';
  const priceChip = item.price && !item.sold
    ? `\n          <span class="cam-card__price">${oldPriceMark}${escapeHtml(item.price)}</span>`
    : '';

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
  renderSiteJsonLd,
  decodeHtmlEntities,
  priceToNumber,
  priceNumber,
  resolveOldPrice,
  cleanupText,
  normalizeLinks,
  todayInWarsaw,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
  renderCard,
  escapeHtml,
  escapeAttribute,
  loadAllegroProducts,
  buildAllegroAffiliateUrl,
  loadAdsConfig,
  normalizeAdsConfig,
  renderAdsHead,
  renderAdUnit,
  renderAdsTxt,
  renderSitemap,
  renderLlmsTxt,
  contentFingerprint,
  resolvePageLastmod,
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
  summarizePriceFreshness,
  reportPriceFreshness,
};
