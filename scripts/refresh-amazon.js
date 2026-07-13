#!/usr/bin/env node

/**
 * Refresh prices (and optional product images) for every ASIN listed in
 * scripts/amazon-products.json. Driven by Playwright so that Amazon doesn't
 * serve us a bot-check page — the runner behaves like a real browser.
 *
 * Failure policy: any ASIN that can't be scraped keeps its previous values.
 * The script never throws unless the JSON itself is unreadable; CI should
 * treat "0 fields changed" as a successful no-op.
 *
 * Amazon anti-bot defense notes:
 *  - We launch chromium with --disable-blink-features=AutomationControlled.
 *  - An init script patches the obvious "I'm a robot" fingerprints
 *    (navigator.webdriver, missing plugins, language array, etc.).
 *  - We "warm up" by hitting amazon.pl once before any product page, then
 *    space requests by ~10–18 seconds. Going faster than that almost always
 *    triggers a captcha after 2–4 successful requests.
 *  - When a captcha does appear, we tear the browser down, sleep, spin a new
 *    session, and retry every failed ASIN once. A captcha on the retry is
 *    treated as a real failure.
 *
 * Usage:
 *   node scripts/refresh-amazon.js                # refresh every ASIN
 *   node scripts/refresh-amazon.js B085R9RN6F     # refresh a single ASIN
 *
 * Requires: playwright + chromium installed in the environment.
 */

const fs = require('node:fs');
const path = require('node:path');

const DATA_FILE = path.join(__dirname, 'amazon-products.json');

const RATE_LIMIT_MS = 10000;     // base delay between product page loads
const RATE_JITTER_MS = 8000;     // random extra delay (so spacing is ~10–18s)
const RETRY_COOL_DOWN_MS = 60000; // pause before retrying captcha-blocked ASINs
const PAGE_TIMEOUT_MS = 30000;
const WARMUP_URL = 'https://www.amazon.pl/';

const USER_AGENTS = [
  // Recent stable Chrome on Windows / macOS — the most common UA strings on
  // amazon.pl, so they don't stand out.
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
];

async function main() {
  const onlyAsin = (process.argv[2] || '').trim();

  const products = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const asinsToCheck = Object.keys(products).filter((a) => !onlyAsin || a === onlyAsin);

  if (asinsToCheck.length === 0) {
    console.error(`No matching ASIN in ${DATA_FILE}.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Refreshing ${asinsToCheck.length} ASIN(s)…`);

  // First pass.
  const captchaAsins = await runPass(asinsToCheck, products, { label: 'pass 1' });

  // Retry any ASIN that hit a captcha, once, with a fresh browser session.
  if (captchaAsins.length > 0) {
    console.log(`\nCaptcha hit ${captchaAsins.length} ASIN(s) — cooling down ${RETRY_COOL_DOWN_MS / 1000}s before retry…`);
    await sleep(RETRY_COOL_DOWN_MS);
    await runPass(captchaAsins, products, { label: 'pass 2 (retry)' });
  }

  fs.writeFileSync(DATA_FILE, `${JSON.stringify(products, null, 2)}\n`, 'utf8');

  // Count only the ASINs this run actually checked — scanning the whole file
  // would let another product's stale lastFailed/lastChecked (from an earlier
  // run today) skew the exit code of a single-ASIN run.
  const failures = asinsToCheck.filter(
    (asin) => products[asin].lastFailed === today(),
  ).length;
  const successes = asinsToCheck.filter(
    (asin) => products[asin].lastChecked === today(),
  ).length;

  console.log(`\nDone. ${successes} ASIN(s) refreshed today, ${failures} still failing.`);
  // Non-zero exit only if every ASIN failed — partial failure is normal.
  if (failures === asinsToCheck.length) {
    process.exitCode = 1;
  }
}

/**
 * Run one pass: open a fresh browser, hit the warmup URL, then iterate
 * through the given ASINs. Returns the list of ASINs that hit a captcha
 * (so the caller can decide whether to retry them).
 */
async function runPass(asins, products, { label }) {
  const { chromium } = require('playwright');

  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--no-sandbox',
    ],
  });

  const userAgent = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];

  const context = await browser.newContext({
    userAgent,
    viewport: { width: 1920, height: 1080 },
    locale: 'pl-PL',
    timezoneId: 'Europe/Warsaw',
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      'accept-language': 'pl-PL,pl;q=0.9,en;q=0.8',
      'upgrade-insecure-requests': '1',
    },
  });

  // Patch the automation fingerprints Amazon checks.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    Object.defineProperty(navigator, 'languages', { get: () => ['pl-PL', 'pl', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'plugins', {
      get: () => [{ name: 'Chrome PDF Plugin' }, { name: 'Chrome PDF Viewer' }, { name: 'Native Client' }],
    });
    // Hide the headless Chrome UA signature on window.chrome.
    // eslint-disable-next-line no-undef
    window.chrome = window.chrome || { runtime: {} };
  });

  // Warm up — establish cookies / session as if a real visitor opened the site.
  try {
    console.log(`\n[${label}] Warming up at amazon.pl…`);
    const page = await context.newPage();
    await page.goto(WARMUP_URL, { waitUntil: 'domcontentloaded', timeout: PAGE_TIMEOUT_MS });
    await page.waitForTimeout(2000 + Math.floor(Math.random() * 1500));
    await page.close();
  } catch (err) {
    console.warn(`[${label}] Warmup failed (${err.message}) — continuing anyway.`);
  }

  const captchaAsins = [];

  for (let index = 0; index < asins.length; index += 1) {
    const asin = asins[index];
    const product = products[asin];
    const page = await context.newPage();

    try {
      await page.goto(`https://www.amazon.pl/dp/${asin}`, {
        waitUntil: 'domcontentloaded',
        timeout: PAGE_TIMEOUT_MS,
      });

      // Simulate a moment of human-like dwell time before reading the DOM.
      await page.waitForTimeout(1200 + Math.floor(Math.random() * 1500));

      const isCaptcha = await page
        .locator('form[action*="validateCaptcha"], #captchacharacters, input[name="amzn"]')
        .first()
        .isVisible({ timeout: 500 })
        .catch(() => false);

      if (isCaptcha) {
        captchaAsins.push(asin);
        throw new Error('Amazon captcha shown');
      }

      const priceText = await firstNonEmpty(page, [
        '#corePriceDisplay_desktop_feature_div .a-offscreen',
        '#corePrice_feature_div .a-offscreen',
        '.a-price[data-a-color="base"] .a-offscreen',
        '.a-price .a-offscreen',
      ]);

      if (priceText) {
        const normalized = normalizePrice(priceText);
        if (normalized && normalized !== product.price) {
          console.log(`  ${asin}: ${product.price || '(none)'} → ${normalized}`);
          product.price = normalized;
        } else if (normalized) {
          console.log(`  ${asin}: ${normalized} (unchanged)`);
        }
      } else {
        throw new Error('price element not found');
      }

      // Only refresh image when the entry already declares one (i.e. we render
      // a real product photo on the card, not a Lomography sample).
      if (Object.prototype.hasOwnProperty.call(product, 'image')) {
        const imageUrl = await page
          .locator('meta[property="og:image"]')
          .first()
          .getAttribute('content')
          .catch(() => null);

        if (imageUrl && imageUrl !== product.image) {
          console.log(`  ${asin}: image updated`);
          product.image = imageUrl;
        }
      }

      product.lastChecked = today();
      delete product.lastFailed;
    } catch (err) {
      product.lastFailed = today();
      console.warn(`  ${asin}: refresh failed — ${err.message}`);
    } finally {
      await page.close();
    }

    // Polite delay between product pages.
    if (index < asins.length - 1) {
      const wait = RATE_LIMIT_MS + Math.floor(Math.random() * RATE_JITTER_MS);
      console.log(`  …waiting ${(wait / 1000).toFixed(1)}s before next ASIN`);
      await sleep(wait);
    }
  }

  await context.close();
  await browser.close();

  return captchaAsins;
}

async function firstNonEmpty(page, selectors) {
  for (const selector of selectors) {
    try {
      const text = await page
        .locator(selector)
        .first()
        .textContent({ timeout: 1500 });
      if (text && text.trim()) {
        return text.trim();
      }
    } catch {
      // try the next selector
    }
  }
  return '';
}

function normalizePrice(raw) {
  // Amazon.pl renders prices like "76,70zł" — keep the comma but space the zł.
  const cleaned = raw
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const match = cleaned.match(/(\d{1,3}(?:[ .]\d{3})*,\d{2})\s*zł/);
  if (!match) return '';
  return `${match[1]} zł`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
