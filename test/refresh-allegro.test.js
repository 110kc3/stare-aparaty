'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  parseAllegroIdentifier,
  formatAllegroPrice,
  mapOfferResponse,
  mapProductResponse,
  fetchAllegroToken,
  refreshAllegroProducts,
} = require('../scripts/refresh-allegro.js');

test('parseAllegroIdentifier: extracts product UUID and offerId', () => {
  const prodUrl = 'https://allegro.pl/produkt/film-czarno-bialy-kodak-400-tri-x-135-36-zdjec-533fa593-a39c-49a2-8d7c-226cddd3b2b8';
  assert.deepEqual(parseAllegroIdentifier(prodUrl), {
    type: 'product',
    productId: '533fa593-a39c-49a2-8d7c-226cddd3b2b8',
  });

  const prodWithOfferUrl = 'https://allegro.pl/produkt/film-kodak-portra-400-135-36-klatek-professional-1-szt-db291570-160e-43fc-ae84-63d91c761b15?offerId=17741420194';
  assert.deepEqual(parseAllegroIdentifier(prodWithOfferUrl), {
    type: 'product',
    productId: 'db291570-160e-43fc-ae84-63d91c761b15',
    offerId: '17741420194',
  });

  const businessOfferUrl = 'https://business.allegro.pl/oferta/film-lomography-orca-czarno-bialy-110-iso-100-9818819333';
  assert.deepEqual(parseAllegroIdentifier(businessOfferUrl), {
    type: 'offer',
    offerId: '9818819333',
  });

  const stdOfferUrl = 'https://allegro.pl/oferta/film-vision-3-1234567890';
  assert.deepEqual(parseAllegroIdentifier(stdOfferUrl), {
    type: 'offer',
    offerId: '1234567890',
  });

  assert.equal(parseAllegroIdentifier(''), null);
  assert.equal(parseAllegroIdentifier(null), null);
  assert.equal(parseAllegroIdentifier('https://google.com/search?q=kodak'), null);
});

test('parseAllegroIdentifier: successfully parses all 15 committed allegro-products', () => {
  const raw = fs.readFileSync(path.join(__dirname, '../scripts/allegro-products.json'), 'utf8');
  const products = JSON.parse(raw);

  assert.equal(Object.keys(products).length, 15);
  for (const [key, item] of Object.entries(products)) {
    const parsed = parseAllegroIdentifier(item.url);
    assert.ok(parsed, `Expected ${key} url (${item.url}) to parse into product or offer id`);
    assert.ok(parsed.productId || parsed.offerId, `Expected ${key} to have productId or offerId`);
  }
});

test('formatAllegroPrice formats numbers to Polish currency format', () => {
  assert.equal(formatAllegroPrice(53.5), '53,50 zł');
  assert.equal(formatAllegroPrice('53.50'), '53,50 zł');
  assert.equal(formatAllegroPrice(140), '140,00 zł');
  assert.equal(formatAllegroPrice('89,33'), '89,33 zł');
  assert.equal(formatAllegroPrice(53.5, true), 'od 53,50 zł');

  assert.throws(() => formatAllegroPrice(-10), /Invalid price amount/);
  assert.throws(() => formatAllegroPrice('invalid'), /Invalid price amount/);
});

test('mapOfferResponse extracts active price and preserves starting prefix', () => {
  const activeOffer = {
    publication: { status: 'ACTIVE' },
    sellingMode: { price: { amount: '48.90', currency: 'PLN' } },
    images: [{ url: 'https://example.com/photo.jpg' }],
  };

  const res1 = mapOfferResponse(activeOffer, { price: '53,00 zł' }, '2026-11-01');
  assert.equal(res1.price, '48,90 zł');
  assert.equal(res1.lastChecked, '2026-11-01');
  assert.equal(res1.image, 'https://example.com/photo.jpg');

  const res2 = mapOfferResponse(activeOffer, { price: 'od 53,00 zł' }, '2026-11-01');
  assert.equal(res2.price, 'od 48,90 zł');
});

test('mapOfferResponse flags inactive or missing prices for manual review', () => {
  const endedOffer = {
    publication: { status: 'ENDED' },
    sellingMode: { price: { amount: '48.90' } },
  };
  const resEnded = mapOfferResponse(endedOffer);
  assert.equal(resEnded.available, false);
  assert.ok(resEnded.error.includes('not active'));

  const noPriceOffer = {
    publication: { status: 'ACTIVE' },
    sellingMode: {},
  };
  const resNoPrice = mapOfferResponse(noPriceOffer);
  assert.equal(resNoPrice.available, false);
  assert.ok(resNoPrice.error.includes('no price'));

  assert.equal(mapOfferResponse(null).available, false);
});

test('mapProductResponse extracts price from listing search results', () => {
  const listingData = {
    items: {
      promoted: [],
      regular: [
        {
          publication: { status: 'ACTIVE' },
          sellingMode: { price: { amount: '31.50', currency: 'PLN' } },
        },
      ],
    },
  };

  const mapped = mapProductResponse(listingData, { price: 'od 32,85 zł' }, '2026-11-01');
  assert.equal(mapped.price, 'od 31,50 zł');
  assert.equal(mapped.lastChecked, '2026-11-01');

  const emptyListing = { items: { regular: [] } };
  const mappedEmpty = mapProductResponse(emptyListing);
  assert.equal(mappedEmpty.available, false);
  assert.ok(mappedEmpty.error);
});

test('fetchAllegroToken sends client credentials and returns token', async () => {
  const mockFetch = async (url, opts) => {
    assert.ok(url.includes('token?grant_type=client_credentials'));
    assert.equal(opts.method, 'POST');
    const authHeader = opts.headers.Authorization;
    assert.ok(authHeader.startsWith('Basic '));
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    assert.equal(decoded, 'test-id:test-secret');

    return {
      ok: true,
      json: async () => ({
        access_token: 'fake-jwt-token-12345',
        token_type: 'bearer',
        expires_in: 43200,
      }),
    };
  };

  const token = await fetchAllegroToken('test-id', 'test-secret', mockFetch);
  assert.equal(token, 'fake-jwt-token-12345');
});

test('refreshAllegroProducts updates prices and flags failures with mock fetch', async () => {
  const mockProducts = {
    'item-1': {
      label: 'Item 1',
      price: '50,00 zł',
      url: 'https://business.allegro.pl/oferta/item-1-9818819333',
      lastChecked: '2026-07-06',
    },
    'item-2': {
      label: 'Item 2',
      price: 'od 100,00 zł',
      url: 'https://allegro.pl/produkt/item-2-533fa593-a39c-49a2-8d7c-226cddd3b2b8',
      lastChecked: '2026-07-06',
    },
    'item-failing': {
      label: 'Item Failing',
      price: '20,00 zł',
      url: 'https://business.allegro.pl/oferta/item-failing-1111111111',
      lastChecked: '2026-07-06',
    },
  };

  const mockFetch = async (url) => {
    if (url.includes('/offers/9818819333')) {
      return {
        ok: true,
        json: async () => ({
          publication: { status: 'ACTIVE' },
          sellingMode: { price: { amount: '54.50' } },
        }),
      };
    }
    if (url.includes('product.id=')) {
      return {
        ok: true,
        json: async () => ({
          items: {
            regular: [
              {
                publication: { status: 'ACTIVE' },
                sellingMode: { price: { amount: '95.00' } },
              },
            ],
          },
        }),
      };
    }
    if (url.includes('/offers/1111111111')) {
      return {
        ok: false,
        status: 404,
      };
    }
    throw new Error('Unexpected URL: ' + url);
  };

  const result = await refreshAllegroProducts({
    products: mockProducts,
    token: 'test-token',
    fetchFn: mockFetch,
    checkDate: '2026-11-01',
  });

  assert.equal(result.updatedCount, 2);
  assert.equal(result.flaggedCount, 1);
  assert.equal(result.products['item-1'].price, '54,50 zł');
  assert.equal(result.products['item-1'].lastChecked, '2026-11-01');
  assert.equal(result.products['item-2'].price, 'od 95,00 zł');
  assert.equal(result.products['item-2'].lastChecked, '2026-11-01');

  assert.equal(result.products['item-failing'].price, '20,00 zł');
  assert.equal(result.products['item-failing'].lastChecked, '2026-07-06');
});
