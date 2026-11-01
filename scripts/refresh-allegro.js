'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { todayInWarsaw } = require('./build-catalog.js');

const PRODUCTS_PATH = path.join(__dirname, 'allegro-products.json');
const ALLEGRO_AUTH_URL = 'https://allegro.pl/auth/oauth/token';
const ALLEGRO_API_BASE = 'https://api.allegro.pl';

/**
 * Extracts product ID (UUID) and/or offer ID from an Allegro URL.
 * Supports:
 * - https://allegro.pl/produkt/<slug>-<uuid>[?offerId=<digits>]
 * - https://business.allegro.pl/oferta/<slug>-<digits>
 * - https://allegro.pl/oferta/<slug>-<digits>
 *
 * @param {string} rawUrl
 * @returns {{ type: 'product'|'offer', productId?: string, offerId?: string } | null}
 */
function parseAllegroIdentifier(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;

  try {
    const url = new URL(rawUrl);
    const offerIdParam = url.searchParams.get('offerId');

    const uuidMatch = url.pathname.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    if (uuidMatch) {
      return {
        type: 'product',
        productId: uuidMatch[1].toLowerCase(),
        ...(offerIdParam && /^\d+$/.test(offerIdParam) ? { offerId: offerIdParam } : {}),
      };
    }

    const offerMatch = url.pathname.match(/-?(\d+)$/);
    if (offerMatch) {
      return {
        type: 'offer',
        offerId: offerMatch[1],
      };
    }

    if (offerIdParam && /^\d+$/.test(offerIdParam)) {
      return {
        type: 'offer',
        offerId: offerIdParam,
      };
    }
  } catch (_err) {
    return null;
  }

  return null;
}

/**
 * Formats numeric price into Polish currency format (e.g. "53,50 zł" or "od 53,50 zł").
 *
 * @param {number|string} amount
 * @param {boolean} isStartingFrom
 * @returns {string}
 */
function formatAllegroPrice(amount, isStartingFrom = false) {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount).replace(',', '.'));
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`Invalid price amount: ${amount}`);
  }

  const formatted = num.toFixed(2).replace('.', ',');
  return isStartingFrom ? `od ${formatted} zł` : `${formatted} zł`;
}

/**
 * Maps an Allegro offer API response to updated price/lastChecked fields.
 *
 * @param {object} offerData
 * @param {object} [existingEntry={}]
 * @param {string} [checkDate]
 * @returns {{ price: string, lastChecked: string, image?: string } | { error: string, available: boolean }}
 */
function mapOfferResponse(offerData, existingEntry = {}, checkDate = todayInWarsaw()) {
  if (!offerData || typeof offerData !== 'object') {
    return { error: 'Empty or invalid offer response', available: false };
  }

  const status = offerData.publication?.status;
  if (status && status !== 'ACTIVE') {
    return { error: `Offer is not active (status: ${status})`, available: false };
  }

  const rawAmount = offerData.sellingMode?.price?.amount;
  if (!rawAmount) {
    return { error: 'Offer response has no price amount', available: false };
  }

  const isStartingFrom = typeof existingEntry.price === 'string' && existingEntry.price.startsWith('od ');
  const formattedPrice = formatAllegroPrice(rawAmount, isStartingFrom);

  const result = {
    price: formattedPrice,
    lastChecked: checkDate,
  };

  const firstImage = offerData.images?.[0]?.url;
  if (firstImage && typeof firstImage === 'string') {
    result.image = firstImage;
  }

  return result;
}

/**
 * Maps an Allegro product API or offers-listing response to updated price/lastChecked fields.
 *
 * @param {object} productData
 * @param {object} [existingEntry={}]
 * @param {string} [checkDate]
 * @returns {{ price: string, lastChecked: string, image?: string } | { error: string, available: boolean }}
 */
function mapProductResponse(productData, existingEntry = {}, checkDate = todayInWarsaw()) {
  if (!productData || typeof productData !== 'object') {
    return { error: 'Empty or invalid product response', available: false };
  }

  // Handle /offers/listing response
  if (Array.isArray(productData.items?.regular) || Array.isArray(productData.items?.promoted)) {
    const allItems = [...(productData.items?.promoted || []), ...(productData.items?.regular || [])];
    const firstActive = allItems.find(
      (item) => item.sellingMode?.price?.amount && (!item.publication?.status || item.publication.status === 'ACTIVE')
    );

    if (firstActive) {
      return mapOfferResponse(firstActive, existingEntry, checkDate);
    }
  }

  // Handle direct product with minPrice or similar
  const rawAmount = productData.minPrice?.amount || productData.price?.amount;
  if (rawAmount) {
    const isStartingFrom = true;
    return {
      price: formatAllegroPrice(rawAmount, isStartingFrom),
      lastChecked: checkDate,
      ...(productData.images?.[0]?.url ? { image: productData.images[0].url } : {}),
    };
  }

  return { error: 'Product response has no valid active offers or price', available: false };
}

/**
 * Obtains an OAuth access token using Client Credentials grant.
 *
 * @param {string} clientId
 * @param {string} clientSecret
 * @param {typeof fetch} [fetchFn=fetch]
 * @returns {Promise<string>}
 */
async function fetchAllegroToken(clientId, clientSecret, fetchFn = fetch) {
  if (!clientId || !clientSecret) {
    throw new Error('ALLEGRO_CLIENT_ID and ALLEGRO_CLIENT_SECRET are required');
  }

  const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await fetchFn(`${ALLEGRO_AUTH_URL}?grant_type=client_credentials`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${credentials}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Allegro OAuth failed (${res.status} ${res.statusText}): ${text}`);
  }

  const data = await res.json();
  if (!data || !data.access_token) {
    throw new Error('Allegro OAuth returned no access_token');
  }

  return data.access_token;
}

/**
 * Refreshes product entries from the Allegro API.
 *
 * @param {object} [options={}]
 * @param {object} [options.products] Products object (defaults to reading allegro-products.json)
 * @param {string} [options.clientId]
 * @param {string} [options.clientSecret]
 * @param {typeof fetch} [options.fetchFn=fetch]
 * @param {string} [options.token]
 * @param {string} [options.checkDate]
 * @returns {Promise<{ products: object, updatedCount: number, flaggedCount: number, errors: string[] }>}
 */
async function refreshAllegroProducts(options = {}) {
  const fetchFn = options.fetchFn || fetch;
  const checkDate = options.checkDate || todayInWarsaw();

  const products = options.products
    ? JSON.parse(JSON.stringify(options.products))
    : JSON.parse(fs.readFileSync(PRODUCTS_PATH, 'utf8'));

  let token = options.token;
  if (!token && options.clientId && options.clientSecret) {
    token = await fetchAllegroToken(options.clientId, options.clientSecret, fetchFn);
  }

  let updatedCount = 0;
  let flaggedCount = 0;
  const errors = [];

  for (const [key, item] of Object.entries(products)) {
    if (item.available === false && !item.url) {
      continue;
    }

    const parsed = parseAllegroIdentifier(item.url);
    if (!parsed) {
      const msg = `Product "${key}" (${item.label}) has unrecognized URL shape: ${item.url}`;
      errors.push(msg);
      flaggedCount++;
      continue;
    }

    if (!token) {
      // Token missing: cannot make live API calls.
      continue;
    }

    try {
      let endpoint = '';
      let isOffer = false;

      if (parsed.offerId) {
        endpoint = `${ALLEGRO_API_BASE}/offers/${parsed.offerId}`;
        isOffer = true;
      } else if (parsed.productId) {
        endpoint = `${ALLEGRO_API_BASE}/offers/listing?product.id=${encodeURIComponent(parsed.productId)}&sort=+price`;
        isOffer = false;
      }

      const res = await fetchFn(endpoint, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.allegro.public.v1+json',
        },
      });

      if (!res.ok) {
        const msg = `Product "${key}" (${item.label}) fetch failed HTTP ${res.status}: ${item.url}`;
        errors.push(msg);
        flaggedCount++;
        continue;
      }

      const body = await res.json();
      const mapped = isOffer
        ? mapOfferResponse(body, item, checkDate)
        : mapProductResponse(body, item, checkDate);

      if (mapped.error) {
        const msg = `Product "${key}" (${item.label}) mapped with error: ${mapped.error}`;
        errors.push(msg);
        flaggedCount++;
        continue;
      }

      // Update fields
      if (mapped.price && mapped.price !== item.price) {
        item.price = mapped.price;
        item.lastChecked = mapped.lastChecked;
        updatedCount++;
      } else if (mapped.price) {
        item.lastChecked = mapped.lastChecked;
      }

      if (mapped.image && !item.image) {
        item.image = mapped.image;
      }
    } catch (err) {
      const msg = `Product "${key}" (${item.label}) error during refresh: ${err.message}`;
      errors.push(msg);
      flaggedCount++;
    }
  }

  return { products, updatedCount, flaggedCount, errors };
}

async function main() {
  const clientId = process.env.ALLEGRO_CLIENT_ID;
  const clientSecret = process.env.ALLEGRO_CLIENT_SECRET;
  const isStrict = process.argv.includes('--strict');
  const isDryRun = process.argv.includes('--dry-run');

  if (!clientId || !clientSecret) {
    const msg = 'ALLEGRO_CLIENT_ID or ALLEGRO_CLIENT_SECRET is missing. Cannot fetch live Allegro prices.';
    if (isStrict) {
      console.error(`::error::${msg}`);
      process.exitCode = 1;
      return;
    }
    console.warn(`::warning::${msg}`);
    console.log('Skipping live price refresh. Pass credentials or run tests with mock data.');
    return;
  }

  console.log('Authenticating with Allegro OAuth...');
  const { products, updatedCount, flaggedCount, errors } = await refreshAllegroProducts({
    clientId,
    clientSecret,
  });

  if (errors.length > 0) {
    for (const err of errors) {
      console.warn(`::warning::${err}`);
    }
  }

  console.log(`Allegro price refresh complete: ${updatedCount} prices updated, ${flaggedCount} flagged for manual review.`);

  if (!isDryRun && updatedCount > 0) {
    fs.writeFileSync(PRODUCTS_PATH, JSON.stringify(products, null, 2) + '\n', 'utf8');
    console.log(`Saved updated prices to ${PRODUCTS_PATH}`);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal error during Allegro refresh:', err);
    process.exitCode = 1;
  });
}

module.exports = {
  parseAllegroIdentifier,
  formatAllegroPrice,
  mapOfferResponse,
  mapProductResponse,
  fetchAllegroToken,
  refreshAllegroProducts,
  ALLEGRO_AUTH_URL,
  ALLEGRO_API_BASE,
};
