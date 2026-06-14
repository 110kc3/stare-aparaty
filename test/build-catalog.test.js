'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatPrice,
  decodeHtmlEntities,
  priceToNumber,
  cleanupText,
  normalizeLinks,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
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
