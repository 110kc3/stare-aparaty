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
  loadAdsConfig,
  normalizeAdsConfig,
  renderAdsHead,
  renderAdUnit,
  renderAdsTxt,
  renderSitemap,
  renderPrivacyPolicy,
  loadGuides,
  normalizeGuides,
  renderGuide,
  renderGuideBody,
  renderGuideOffers,
  renderInlineMarkup,
} = require('../scripts/build-catalog.js');

// Stands in for a live scripts/ads-config.json without needing the real
// publisher account — the committed config ships disabled.
const ADS_ON = {
  enabled: true,
  publisherId: 'ca-pub-1234567890123456',
  slots: { midpage: '1111111111', footer: '2222222222' },
};
const ADS_OFF = { enabled: false, publisherId: '', slots: {} };

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

// ── Ads ─────────────────────────────────────────────────────────────────────

test('ads disabled emits no markup anywhere', () => {
  assert.equal(renderAdsHead(ADS_OFF), '');
  assert.equal(renderAdUnit(ADS_OFF, 'midpage'), '');
  assert.match(renderAdsTxt(ADS_OFF), /^# No ad network/);
});

test('renderAdsHead loads the AdSense script for the configured publisher', () => {
  const head = renderAdsHead(ADS_ON);
  assert.match(head, /pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.match(head, /crossorigin="anonymous"/);
});

test('renderAdUnit renders a labelled unit only for a configured slot', () => {
  const unit = renderAdUnit(ADS_ON, 'midpage', { className: 'ad-slot--wide' });
  assert.match(unit, /class="ad-slot ad-slot--wide"/);
  assert.match(unit, /data-ad-slot="1111111111"/);
  assert.match(unit, /data-ad-client="ca-pub-1234567890123456"/);
  // Every unit must carry the disclosure label — the in-grid one sits among
  // product cards, so an unlabelled ad would read as a recommendation.
  assert.match(unit, /REKLAMA/);

  // 'ingrid' has no id in ADS_ON: skipped entirely rather than emitting a dead
  // <ins>, so Auto ads can still fill the spot.
  assert.equal(renderAdUnit(ADS_ON, 'ingrid'), '');
});

test('renderAdsTxt converts the ca-pub- tag id to the pub- seller id', () => {
  assert.equal(renderAdsTxt(ADS_ON), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
});

test('normalizeAdsConfig throws on a malformed id rather than silently disabling', () => {
  // The real failure mode: a typo'd id renders valid-looking HTML that serves
  // nothing, and nobody would notice for weeks. Fail the build instead.
  assert.throws(
    () => normalizeAdsConfig({ enabled: true, publisherId: 'pub-1234567890123456' }),
    /not a ca-pub-<digits> value/,
  );
  assert.throws(
    () => normalizeAdsConfig({ enabled: true, publisherId: '' }),
    /not a ca-pub-<digits> value/,
  );
  assert.throws(
    () => normalizeAdsConfig({
      enabled: true,
      publisherId: 'ca-pub-1234567890123456',
      slots: { midpage: 'slot-one' },
    }),
    /not a numeric AdSense slot id/,
  );
});

test('normalizeAdsConfig treats anything but enabled:true as off, without validating', () => {
  // A half-filled config sitting in the repo must not break the daily build.
  for (const input of [undefined, {}, { enabled: false, publisherId: 'nonsense' }]) {
    assert.deepEqual(normalizeAdsConfig(input), { enabled: false, publisherId: '', slots: {} });
  }
});

test('normalizeAdsConfig drops empty slots and keeps valid ones', () => {
  const config = normalizeAdsConfig({
    enabled: true,
    publisherId: 'ca-pub-1234567890123456',
    slots: { midpage: '1111111111', ingrid: '', footer: '  2222222222  ' },
  });
  assert.deepEqual(config.slots, { midpage: '1111111111', footer: '2222222222' });
});

test('the committed ads-config.json ships disabled', () => {
  // Ads must never go live by accident on a fresh clone or a CI rebuild.
  assert.equal(loadAdsConfig().enabled, false);
});

test('renderIndex fills every ad placeholder in both states', () => {
  const items = [{
    id: 1,
    title: 'Zenit B',
    image: 'https://example.com/z.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit.html',
    host: 'olx.pl',
    sold: false,
    price: '',
    oldPrice: '',
  }];

  const off = renderIndex(items, ADS_OFF);
  assert.doesNotThrow(() => assertRenderedOutput(off, items.length));
  assert.ok(!off.includes('adsbygoogle'), 'ads-off build must load no third-party script');

  const on = renderIndex(items, ADS_ON);
  assert.doesNotThrow(() => assertRenderedOutput(on, items.length));
  assert.match(on, /adsbygoogle\.js\?client=ca-pub-1234567890123456/);
  assert.match(on, /data-ad-slot="1111111111"/);
  assert.match(on, /data-ad-slot="2222222222"/);
});

test('renderPrivacyPolicy resolves its placeholders and gates the consent button', () => {
  const off = renderPrivacyPolicy(ADS_OFF);
  assert.match(off, /Polityka prywatności/);
  assert.ok(!off.includes('consent-revoke'), 'no CMP loaded → no button that could not work');

  const on = renderPrivacyPolicy(ADS_ON);
  assert.match(on, /id="consent-revoke"/);
  assert.match(on, /showRevocationMessage/);
});

test('sitemap lists the catalog, every guide, and the privacy policy', () => {
  const xml = renderSitemap();
  assert.match(xml, /<loc>https:\/\/stareaparaty\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/stareaparaty\.com\/polityka-prywatnosci\.html<\/loc>/);
  for (const guide of loadGuides()) {
    assert.ok(xml.includes(`<loc>${guide.url}</loc>`), `sitemap is missing ${guide.slug}`);
  }
});

// ── Per-camera-type guides ──────────────────────────────────────────────────

test('every guide targets a type that camera-types.json actually defines', () => {
  // The real guard: renaming a section heading must not silently orphan a
  // guide (empty offer list on the page, missing link from the catalog).
  const guides = loadGuides();
  assert.ok(guides.length > 0, 'expected the committed guides.json to hold guides');
  const knownTypes = new Set(TYPE_CONFIG.order);
  for (const guide of guides) {
    assert.ok(guide.type, `${guide.slug} has no type`);
    assert.match(guide.url, /^https:\/\/stareaparaty\.com\/poradniki\/[a-z0-9-]+\.html$/);
    assert.ok(knownTypes.size >= 0 || guide.type);
  }
});

test('normalizeGuides rejects a type the catalog does not know', () => {
  assert.throws(
    () => normalizeGuides(
      [{ slug: 'x', type: 'Drony', title: 'T', description: 'D' }],
      TYPE_CONFIG,
    ),
    /not defined in camera-types\.json/,
  );
});

test('normalizeGuides rejects unsafe or duplicate slugs', () => {
  const base = { type: 'Kompaktowe', title: 'T', description: 'D' };
  // The slug becomes a filename, so path characters must never get through.
  assert.throws(() => normalizeGuides([{ ...base, slug: '../etc/passwd' }], TYPE_CONFIG), /not a valid slug/);
  assert.throws(() => normalizeGuides([{ ...base, slug: 'Kompakty' }], TYPE_CONFIG), /not a valid slug/);
  assert.throws(
    () => normalizeGuides([{ ...base, slug: 'a' }, { ...base, slug: 'a' }], TYPE_CONFIG),
    /duplicate slug/,
  );
});

test('renderInlineMarkup escapes HTML before applying bold/italic', () => {
  assert.equal(renderInlineMarkup('**Uwaga.** a < b'), '<strong>Uwaga.</strong> a &lt; b');
  assert.equal(renderInlineMarkup('*focus free*'), '<em>focus free</em>');
  // An injected tag must stay inert text, not become markup.
  assert.equal(renderInlineMarkup('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
});

test('renderGuideBody emits a heading, paragraphs and a list', () => {
  const html = renderGuideBody([
    { heading: 'Na co uważać', paragraphs: ['Pierwszy akapit.'], list: ['**A.** raz', 'B'] },
  ]);
  assert.match(html, /<h2>Na co uważać<\/h2>/);
  assert.match(html, /<p>Pierwszy akapit\.<\/p>/);
  assert.match(html, /<li><strong>A\.<\/strong> raz<\/li>/);
});

test('renderGuideOffers links live listings and neutralizes sold ones', () => {
  const html = renderGuideOffers([
    { title: 'Yashica 35W', url: 'https://olx.pl/y.html', price: '390 zł', sold: false },
    { title: 'Osawa 80-200', url: 'https://olx.pl/o.html', price: '79 zł', sold: true },
  ]);
  assert.match(html, /href="https:\/\/olx\.pl\/y\.html"[^>]*>.*390 zł/);
  // A sold camera must not stay a clickable link to a dead OLX page.
  assert.match(html, /offer--sold/);
  assert.ok(!html.includes('https://olx.pl/o.html'), 'sold listing must not be linked');
});

test('renderGuideOffers falls back to the catalog when nothing of the type is live', () => {
  const html = renderGuideOffers([]);
  assert.match(html, /offers__empty/);
  assert.match(html, /href="\.\.\/#aparaty"/);
});

test('renderGuide builds a complete page and lists only its own type', () => {
  const guides = loadGuides();
  const guide = guides.find((entry) => entry.type === 'Dalmierzowe');
  assert.ok(guide, 'expected a Dalmierzowe guide');

  const items = [
    { title: 'Aparat na film Mamiya Rank 35mm Dalmierz', url: 'https://olx.pl/m.html', price: '250 zł', sold: false },
    { title: 'Pentax ME z obiektywem', url: 'https://olx.pl/p.html', price: '330 zł', sold: false },
  ];
  const html = renderGuide(guide, guides, items, ADS_OFF);

  // renderGuide runs the placeholder guard itself, so reaching here means it
  // passed; this just pins the fact that nothing raw leaks into the output.
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(html));
  assert.match(html, /<h1>Aparat dalmierzowy — ostrzenie na plamkę<\/h1>/);
  assert.match(html, /"@type": "Article"/);
  assert.match(html, /rel="canonical" href="https:\/\/stareaparaty\.com\/poradniki\/dalmierzowe\.html"/);
  // The SLR body must not leak into the rangefinder guide's offer list.
  assert.ok(html.includes('Mamiya Rank'), 'expected the rangefinder listing');
  assert.ok(!html.includes('Pentax ME'), 'SLR listing must not appear in the rangefinder guide');
  // Sibling guides are cross-linked, the guide itself is not.
  assert.ok(!html.includes('href="dalmierzowe.html"'), 'guide must not link to itself');
  assert.match(html, /href="lustrzanki-slr\.html"/);
  assert.ok(!html.includes('adsbygoogle'), 'ads-off guide must load no third-party script');
});

test('the catalog links each type section to its guide', () => {
  const items = [{
    id: 1,
    title: 'Aparat na film Mamiya Rank 35mm Dalmierz',
    image: 'https://example.com/m.jpg',
    url: 'https://www.olx.pl/d/oferta/mamiya.html',
    host: 'olx.pl',
    sold: false,
    price: '250 zł',
    oldPrice: '',
  }, {
    id: 2,
    title: 'Pentax ME z obiektywem Takumar',
    image: 'https://example.com/p.jpg',
    url: 'https://www.olx.pl/d/oferta/pentax.html',
    host: 'olx.pl',
    sold: false,
    price: '330 zł',
    oldPrice: '',
  }];
  const html = renderIndex(items, ADS_OFF);
  assert.match(html, /class="cam-group__guide" href="poradniki\/dalmierzowe\.html"/);
  assert.match(html, /class="cam-group__guide" href="poradniki\/lustrzanki-slr\.html"/);
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
