#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const LINKS_FILE = path.join(ROOT_DIR, 'product-links.txt');
const TEMPLATE_FILE = path.join(ROOT_DIR, 'templates', 'index.template.html');
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
    };
  } catch (error) {
    console.warn(`Falling back for ${url}: ${error.message}`);
    return {
      title: fallbackItem?.title || buildFallbackTitle(url),
      image: fallbackItem?.image || createPlaceholderImage(buildFallbackTitle(url)),
      url,
      host: new URL(url).hostname.replace(/^www\./, ''),
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
  };
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
  const template = fs.readFileSync(TEMPLATE_FILE, 'utf8');
  const renderedCards = items.length > 0
    ? items.map((item, index) => renderCard(item, index)).join('\n')
    : '<article class="catalog-empty pixel-frame"><p>Brak ofert do wyświetlenia w tej chwili.</p></article>';

  const lastUpdated = new Intl.DateTimeFormat('pl-PL', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Europe/Warsaw',
  }).format(new Date());

  return template
    .replace('{{COUNT}}', String(items.length))
    .replace('{{LAST_UPDATED}}', escapeHtml(lastUpdated))
    .replace('{{CAMERA_CARDS}}', renderedCards);
}

function renderCard(item, index) {
  return `
        <article class="camera-card pixel-frame">
          <div class="camera-card__media">
            <span class="camera-card__serial">KADR ${String(index + 1).padStart(2, '0')}</span>
            <img class="pixelated" src="${escapeAttribute(item.image)}" alt="${escapeAttribute(item.title)}">
          </div>
          <div class="camera-card__body">
            <p class="camera-card__meta">Ogłoszenie z ${escapeHtml(item.host)}</p>
            <h3 class="camera-card__title">${escapeHtml(item.title)}</h3>
            <p class="camera-card__caption">Sprawdź szczegóły oferty, zdjęcia i aktualną dostępność.</p>
            <div class="camera-card__actions">
              <a class="camera-card__link" href="${escapeAttribute(item.url)}" target="_blank" rel="noopener noreferrer">Otwórz ogłoszenie</a>
            </div>
          </div>
        </article>`;
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
