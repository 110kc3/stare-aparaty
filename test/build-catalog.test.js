'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formatPrice,
  getMetaContent,
  renderIndex,
  decodeHtmlEntities,
  priceToNumber,
  resolveOldPrice,
  cleanupText,
  normalizeLinks,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
  renderCard,
  loadAllegroProducts,
} = require('../scripts/build-catalog.js');

const TYPE_CONFIG = {
  rules: [
    { match: ['^obiektyw'], type: 'Obiektywy' },
    { match: ['kolekcja'], type: 'Zestawy' },
    { match: ['dalmierz', '35w'], type: 'Dalmierzowe' },
    { match: ['kompakt', 'quasar'], type: 'Kompaktowe' },
  ],
  fallback: 'Lustrzanki (SLR)',
  order: ['Lustrzanki (SLR)', 'Kompaktowe', 'Dalmierzowe', 'Zestawy', 'Obiektywy'],
};

test('formatPrice handles whitespace thousands separators and comma decimals', () => {
  assert.equal(formatPrice('1 234,56', 'PLN'), '1234,56 zł');
  assert.equal(formatPrice('120', 'PLN'), '120 zł');
  assert.equal(formatPrice(120, 'PLN'), '120 zł');
});

test('formatPrice rejects non-positive / non-numeric amounts', () => {
  assert.equal(formatPrice('', 'PLN'), '');
  assert.equal(formatPrice('abc', 'PLN'), '');
  assert.equal(formatPrice(0, 'PLN'), '');
  assert.equal(formatPrice(-5, 'PLN'), '');
});

test('formatPrice keeps a non-PLN currency as a suffix', () => {
  assert.equal(formatPrice('99', 'EUR'), '99 EUR');
});

test('decodeHtmlEntities decodes &amp; last (no double-decode)', () => {
  // "&amp;lt;" must become "&lt;", not a raw "<".
  assert.equal(decodeHtmlEntities('&amp;lt;'), '&lt;');
  assert.equal(decodeHtmlEntities('Tom &amp; Jerry'), 'Tom & Jerry');
  assert.equal(decodeHtmlEntities('&quot;hi&quot; &#39;a&#39;'), '"hi" \'a\'');
});

test('getMetaContent keeps an apostrophe inside a double-quoted value', () => {
  const html = '<meta property="og:title" content="Canon\'s AE-1 Program">';
  assert.equal(getMetaContent(html, 'property', 'og:title'), "Canon's AE-1 Program");
});

test('getMetaContent reads single-quoted and content-first meta tags', () => {
  assert.equal(
    getMetaContent('<meta property=\'og:title\' content=\'Aparat "Start"\'>', 'property', 'og:title'),
    'Aparat "Start"',
  );
  assert.equal(
    getMetaContent('<meta content="Zenit B" property="og:title">', 'property', 'og:title'),
    'Zenit B',
  );
  assert.equal(getMetaContent('<meta property="og:title">', 'property', 'og:title'), '');
});

test('renderIndex survives $-replacement sequences in listing titles', () => {
  const items = [{
    id: 1,
    title: "Zenit $& $' $` promocja",
    image: 'https://example.com/z.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit.html',
    host: 'olx.pl',
    sold: false,
    price: '',
    oldPrice: '',
  }];
  const html = renderIndex(items);
  // The title must land verbatim (HTML-escaped), not be expanded as a
  // String.replace pattern — and no placeholder may leak through.
  assert.ok(html.includes("Zenit $&amp; $' $` promocja"));
  assert.doesNotThrow(() => assertRenderedOutput(html, items.length));
});

test('priceToNumber extracts a bare numeric value', () => {
  assert.equal(priceToNumber('120 zł'), '120');
  assert.equal(priceToNumber('1 234,56 zł'), '1234.56');
  assert.equal(priceToNumber(''), '');
  assert.equal(priceToNumber('Cena do uzgodnienia'), '');
});

test('cleanupText collapses whitespace and strips the OLX suffix', () => {
  assert.equal(cleanupText('Aparat   Zenit  | OLX.pl'), 'Aparat Zenit');
  assert.equal(cleanupText('Pentax SF7 - OLX'), 'Pentax SF7');
});

test('normalizeLinks dedupes and trims trailing punctuation', () => {
  const out = normalizeLinks(
    'https://olx.pl/a, https://olx.pl/b\nhttps://olx.pl/a;https://olx.pl/c)',
  );
  assert.deepEqual(out, ['https://olx.pl/a', 'https://olx.pl/b', 'https://olx.pl/c']);
});

test('assertRenderedOutput rejects leftover placeholders', () => {
  assert.throws(
    () => assertRenderedOutput('<div>{{CAMERA_CARDS}} cam-card</div>', 1),
    /unresolved placeholders/,
  );
});

test('assertRenderedOutput rejects a card-less grid when items exist', () => {
  assert.throws(() => assertRenderedOutput('<div>nothing here</div>', 3), /none were rendered/i);
});

test('assertRenderedOutput passes for clean output (and for an empty catalog)', () => {
  assert.doesNotThrow(() => assertRenderedOutput('<a class="cam-card">x</a>', 1));
  assert.doesNotThrow(() => assertRenderedOutput('<p>Brak ofert</p>', 0));
});

test('classifyType: first matching keyword wins, else fallback', () => {
  assert.equal(classifyType('Aparat kompaktowy Minolta F25', TYPE_CONFIG), 'Kompaktowe');
  assert.equal(classifyType('Quasar Smart na film', TYPE_CONFIG), 'Kompaktowe');
  assert.equal(classifyType('Yashica 35W dalmierz', TYPE_CONFIG), 'Dalmierzowe');
  assert.equal(classifyType('Obiektyw manualny Osawa', TYPE_CONFIG), 'Obiektywy');
  assert.equal(classifyType('Kolekcja aparatów Canon EOS', TYPE_CONFIG), 'Zestawy');
  // No keyword → fallback (SLR).
  assert.equal(classifyType('Aparat Zenit-B z Helios-44', TYPE_CONFIG), 'Lustrzanki (SLR)');
});

test('classifyType: "z obiektywem" is a camera, not a standalone lens', () => {
  // The ^ anchor means only titles that START with "obiektyw" are lenses.
  assert.equal(
    classifyType('Aparat Praktica Super TL 2 z obiektywem Hanimex 28mm', TYPE_CONFIG),
    'Lustrzanki (SLR)',
  );
});

test('groupByType returns non-empty buckets in configured order', () => {
  const items = [
    { title: 'Aparat Zenit-B' }, // SLR
    { title: 'Aparat kompaktowy F25' }, // Kompaktowe
    { title: 'Pentax ME' }, // SLR
    { title: 'Obiektyw Osawa' }, // Obiektywy
  ];
  const groups = groupByType(items, TYPE_CONFIG);
  assert.deepEqual(
    groups.map(([type, group]) => [type, group.length]),
    [['Lustrzanki (SLR)', 2], ['Kompaktowe', 1], ['Obiektywy', 1]],
  );
});

test('groupByType appends types not named in order, last', () => {
  const config = { rules: [{ match: ['lampa'], type: 'Lampy' }], fallback: 'Inne', order: ['Inne'] };
  const groups = groupByType([{ title: 'Lampa' }, { title: 'Aparat' }], config);
  assert.deepEqual(groups.map(([type]) => type), ['Inne', 'Lampy']);
});

test('mapWithConcurrency preserves order and bounds in-flight work', async () => {
  let inFlight = 0;
  let maxInFlight = 0;
  const items = [1, 2, 3, 4, 5, 6, 7];
  const out = await mapWithConcurrency(items, 2, async (n) => {
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 5));
    inFlight -= 1;
    return n * 10;
  });
  assert.deepEqual(out, [10, 20, 30, 40, 50, 60, 70]);
  assert.ok(maxInFlight <= 2, `expected <=2 in flight, saw ${maxInFlight}`);
});

test('resolveOldPrice: no previous snapshot means no struck price', () => {
  assert.equal(resolveOldPrice('320 zł', undefined), '');
  assert.equal(resolveOldPrice('320 zł', {}), '');
});

test('resolveOldPrice: a first drop surfaces the previous price', () => {
  // Last build saw 390; now it is 320 -> strike 390.
  assert.equal(resolveOldPrice('320 zł', { price: '390 zł' }), '390 zł');
});

test('resolveOldPrice: the original (highest) price persists across rebuilds', () => {
  // Price unchanged at 320 while a drop from 390 is already recorded.
  assert.equal(
    resolveOldPrice('320 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
  // A further drop to 300 still shows the original 390, not the interim 320.
  assert.equal(
    resolveOldPrice('300 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
  // A partial rebound (still below the all-time high) keeps the high.
  assert.equal(
    resolveOldPrice('350 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
});

test('resolveOldPrice: a new all-time high clears the struck price', () => {
  assert.equal(resolveOldPrice('400 zł', { price: '320 zł', oldPrice: '390 zł' }), '');
  // Equal to the prior high (no drop) also clears it.
  assert.equal(resolveOldPrice('390 zł', { price: '390 zł' }), '');
});

test('resolveOldPrice: an unknown current price preserves the stored high', () => {
  assert.equal(resolveOldPrice('', { price: '320 zł', oldPrice: '390 zł' }), '390 zł');
});

test('renderCard: a marked-down listing strikes the original price', () => {
  const html = renderCard({
    title: 'Aparat Zenit-B',
    image: 'https://example.com/z.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit-b.html',
    host: 'olx.pl',
    sold: false,
    price: '320 zł',
    oldPrice: '390 zł',
  });
  assert.match(html, /<s class="cam-card__price-was">390 zł<\/s>/);
  assert.match(html, /320 zł<\/span>/);
});

test('renderCard: no old price renders a plain price chip', () => {
  const html = renderCard({
    title: 'Aparat Zenit-B',
    image: 'https://example.com/z.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit-b.html',
    host: 'olx.pl',
    sold: false,
    price: '320 zł',
    oldPrice: '',
  });
  assert.ok(!html.includes('cam-card__price-was'));
  assert.match(html, /<span class="cam-card__price">320 zł<\/span>/);
});

test('renderCard: a sold listing shows neither price chip nor struck price', () => {
  const html = renderCard({
    title: 'Aparat Zenit-B',
    image: 'https://example.com/z.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit-b.html',
    host: 'olx.pl',
    sold: true,
    price: '320 zł',
    oldPrice: '390 zł',
  });
  assert.ok(!html.includes('cam-card__price'));
});

test('camera-types.json: a plural "Aparaty …" multi-camera listing is a Zestaw', () => {
  const config = require('../scripts/camera-types.json');
  assert.equal(
    classifyType(
      'Aparaty na film Kodak Duaflex II, Brownie Cresta 3, Retina If Gliwice Sikornik',
      config,
    ),
    'Zestawy',
  );
  // The existing "Kolekcja …" set still groups as a Zestaw.
  assert.equal(classifyType('Kolekcja aparatów Canon EOS', config), 'Zestawy');
  // A single camera (singular "Aparat") must NOT be pulled into Zestawy.
  assert.equal(classifyType('Aparat Zenit-B z obiektywem Helios-44', config), 'Lustrzanki (SLR)');
});

// --- Allegro manual price data -------------------------------------------
// Allegro card prices are data-driven from scripts/allegro-products.json the
// same way Amazon prices come from amazon-products.json. These guard that the
// data file and the template never drift apart (a mismatch would either leave
// a {{ALLEGRO_PRICE_*}} placeholder in the page or silently drop a price).

const TEMPLATE_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'templates', 'index.template.html'),
  'utf8',
);
const ALLEGRO_PRODUCTS = require('../scripts/allegro-products.json');

test('allegro-products.json entries are well-formed', () => {
  const keys = Object.keys(ALLEGRO_PRODUCTS);
  assert.ok(keys.length > 0, 'expected at least one Allegro product');
  for (const key of keys) {
    const data = ALLEGRO_PRODUCTS[key];
    assert.ok(
      typeof data.price === 'string' && data.price.trim().length > 0,
      `${key}: price must be a non-empty string`,
    );
    assert.match(data.url, /^https:\/\/(www\.|business\.)?allegro\.pl\//, `${key}: url`);
    assert.match(data.lastChecked, /^\d{4}-\d{2}-\d{2}$/, `${key}: lastChecked`);
  }
});

test('template {{ALLEGRO_PRICE_*}} placeholders match the JSON keys exactly', () => {
  const placeholderKeys = [...TEMPLATE_HTML.matchAll(/\{\{ALLEGRO_PRICE_([a-z0-9-]+)\}\}/g)]
    .map((m) => m[1])
    .sort();
  const jsonKeys = Object.keys(ALLEGRO_PRODUCTS).sort();
  // Every placeholder has a data entry, every data entry is used once, no dupes.
  assert.deepEqual(placeholderKeys, jsonKeys);
});

test('loadAllegroProducts returns products and the oldest lastChecked date', () => {
  const loaded = loadAllegroProducts();
  assert.ok(Object.keys(loaded.products).length > 0);
  assert.match(loaded.lastRefreshed, /^\d{4}-\d{2}-\d{2}$/);
  const allDates = Object.values(loaded.products).map((p) => p.lastChecked).sort();
  assert.equal(loaded.lastRefreshed, allDates[0]);
});
