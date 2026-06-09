#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LINKS_FILE = path.join(ROOT_DIR, 'product-links.txt');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'index.template.html');
const AMAZON_PRODUCTS_FILE = path.join(__dirname, 'amazon-products.json');
const OUTPUT_HTML = path.join(ROOT_DIR, 'index.html');
const OUTPUT_JSON = path.join(ROOT_DIR, 'olx_meta.json');

const args = parseArgs(process.argv.slice(2));

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function main() {
  const links = loadLinks(args);
  const previousMetadata = loadPreviousMetadata();
  const items = [];

  for (const link of links) {
    const item = await buildItem(link, previousMetadata.get(link));
    items.push(item);
  }

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

  fs.writeFileSync(OUTPUT_JSON, `${JSON.stringify(normalizedItems, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUTPUT_HTML, renderIndex(normalizedItems), 'utf8');

  console.log(`Built catalog with ${normalizedItems.length} item(s).`);
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
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; StareAparatyBot/1.0; +https://github.com/110kc3/stare-aparaty)',
        'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
      },
      redirect: 'follow',
    });

    // OLX returns 410 (Gone) — and sometimes 404 — when a listing is removed,
    // which almost always means the camera was sold. Mark the card so the
    // template can render a SPRZEDANE state instead of a broken click.
    if (response.status === 410 || response.status === 404) {
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
  const value = Number(String(amount).replace(',', '.'));
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
  const renderedCards = items.length > 0
    ? items.map((item, index) => renderCard(item, index)).join('\n')
    : '      <p style="grid-column:1/-1;padding:24px;color:var(--ink-soft);text-align:center;">Brak ofert do wyświetlenia w tej chwili.</p>';

  const lastUpdated = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date());

  rendered = rendered
    .replace('{{COUNT}}', String(items.length))
    .replace('{{LAST_UPDATED}}', escapeHtml(lastUpdated))
    .replace('{{CAMERA_CARDS}}', renderedCards);

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

function renderCard(item, index = 0) {
  // First row (4 cards) loads eagerly for fast above-the-fold paint;
  // everything below lazy-loads.
  const loadingAttrs = index < 4 ? '' : ' loading="lazy" decoding="async"';
  const priceChip = item.price && !item.sold
    ? `\n          <span class="cam-card__price">${escapeHtml(item.price)}</span>`
    : '';

  if (item.sold) {
    return `
      <div class="cam-card cam-card--sold" aria-label="Sprzedane">
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
      </div>`;
  }
  return `
      <a class="cam-card" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">
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
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
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
