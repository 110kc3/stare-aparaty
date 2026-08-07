'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  extractOffers,
  extractOffersStrict,
  extractOffersLoose,
  decodeUnicode,
  matchesKeyword,
  withPage,
  parseArgs,
  countLinks,
  shrinkRefusal,
} = require('../scripts/discover-listings.js');

// A fragment shaped like OLX's embedded JSON blob, with the keys in the exact
// order the strict parser expects.
const STRICT_BLOB =
  '...{"title":"Aparat Zenit B","status":"active",' +
  '"url":"https://www.olx.pl/d/oferta/zenit-b-abc123.html","user":{"id":42}},' +
  '{"title":"Lampa","status":"removed",' +
  '"url":"https://www.olx.pl/d/oferta/lampa-xyz789.html","user":{"id":42}}...';

// Same two offers, but with the keys reordered so the strict regex misses them.
const REORDERED_BLOB =
  '...{"status":"active","user":{"id":42,"name":"k"},"title":"Aparat Zenit B",' +
  '"url":"https://www.olx.pl/d/oferta/zenit-b-abc123.html"},' +
  '{"user":{"id":42},"status":"active","title":"Pentax SF7",' +
  '"url":"https://www.olx.pl/d/oferta/pentax-sf7-def456.html"}...';

test('extractOffersStrict reads title/status/url/ownerId in key order', () => {
  const offers = extractOffersStrict(STRICT_BLOB);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers[0], {
    title: 'Aparat Zenit B',
    status: 'active',
    url: 'https://www.olx.pl/d/oferta/zenit-b-abc123.html',
    ownerId: '42',
  });
});

test('extractOffersStrict returns nothing when keys are reordered', () => {
  assert.equal(extractOffersStrict(REORDERED_BLOB).length, 0);
});

test('extractOffersLoose recovers offers regardless of key order', () => {
  const offers = extractOffersLoose(REORDERED_BLOB);
  const titles = offers.map((o) => o.title).sort();
  assert.deepEqual(titles, ['Aparat Zenit B', 'Pentax SF7']);
  assert.ok(offers.every((o) => o.ownerId === '42'));
  assert.ok(offers.every((o) => o.url.startsWith('https://www.olx.pl/d/oferta/')));
});

test('extractOffers falls back to the loose parser only when strict finds none', () => {
  assert.equal(extractOffers(STRICT_BLOB).length, 2);
  assert.equal(extractOffers(REORDERED_BLOB).length, 2);
});

test('decodeUnicode turns \\uXXXX escapes into characters', () => {
  assert.equal(decodeUnicode('Aparat \\u017celazny'), 'Aparat żelazny');
});

test('matchesKeyword filters by the camera keyword list', () => {
  assert.ok(matchesKeyword('Aparat analogowy Zenit'));
  assert.ok(matchesKeyword('Pentax SF7')); // brand-only title
  assert.ok(matchesKeyword('Obiektyw manualny Osawa MC 80-200mm')); // standalone lens
  assert.ok(matchesKeyword('Praktica z obiektywem Hanimex')); // inflected "obiektywem"
  assert.ok(!matchesKeyword('Rower górski'));
});

test('withPage sets the page query param', () => {
  assert.equal(
    withPage('https://www.olx.pl/oferty/uzytkownik/abc/?categoryId=99', 3),
    'https://www.olx.pl/oferty/uzytkownik/abc/?categoryId=99&page=3',
  );
});

test('countLinks ignores blank lines and surrounding whitespace', () => {
  assert.equal(countLinks('a\nb\nc\n'), 3);
  assert.equal(countLinks('  a  \n\n\n  b\n'), 2);
  assert.equal(countLinks(''), 0);
});

// The regression this guards: a partial OLX scrape returned 10 of 19 listings
// and the old code wrote it, deleting 9 cameras from the live site for a day.
test('shrinkRefusal blocks the 19 -> 10 partial-scrape case', () => {
  const refusal = shrinkRefusal(19, 10);
  assert.ok(refusal, 'a 47% drop must be refused');
  assert.match(refusal, /19/);
  assert.match(refusal, /--allow-shrink/);
});

test('shrinkRefusal allows ordinary day-to-day shrinkage', () => {
  assert.equal(shrinkRefusal(19, 18), null); // one camera sold
  assert.equal(shrinkRefusal(19, 14), null); // 26% — under the limit
  assert.equal(shrinkRefusal(19, 19), null); // unchanged
  assert.equal(shrinkRefusal(19, 25), null); // growth is never suspicious
});

test('shrinkRefusal stays quiet on small or absent previous lists', () => {
  // Percentages are meaningless on a tiny list, and a first run has no file.
  assert.equal(shrinkRefusal(0, 0), null);
  assert.equal(shrinkRefusal(4, 1), null);
  assert.ok(shrinkRefusal(5, 1), 'at the floor the guard starts applying');
});

test('parseArgs understands --allow-shrink', () => {
  assert.equal(parseArgs([]).allowShrink, false);
  assert.equal(parseArgs(['--allow-shrink']).allowShrink, true);
  assert.equal(parseArgs(['--dry-run']).dryRun, true);
});
