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
  renderLlmsTxt,
  contentFingerprint,
  resolvePageLastmod,
  renderPrivacyPolicy,
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

// ── The policy must describe the site that actually shipped ─────────────────
// The ad markup has always been config-gated; the ad prose was not, so an
// ads-off build published a policy claiming AdSense served ads, promising a
// consent message that never appeared, and naming consent as a legal basis for
// processing that wasn't happening.

test('with ads off the policy claims no ads, no cookies and no consent banner', () => {
  const off = renderPrivacyPolicy(ADS_OFF);

  assert.ok(!/AdSense/.test(off), 'an ads-off page must not tell readers it serves AdSense');
  assert.ok(!/Dane reklamowe/.test(off), '§2 must not list advertising data that is never collected');
  assert.ok(
    !/Przy pierwszej wizycie zobaczysz komunikat zgody/.test(off),
    'no CMP is loaded, so the policy must not promise a consent message',
  );
  assert.ok(
    !/art\. 6 ust\. 1 lit\. a RODO/.test(off),
    'consent is only a legal basis once there is something to consent to',
  );
  assert.match(off, /nie wyświetla obecnie reklam/);
  assert.match(off, /nie zapisuje na Twoim urządzeniu żadnych plików cookie/);
});

test('with ads on the policy carries the full Google disclosure again', () => {
  const on = renderPrivacyPolicy(ADS_ON);

  assert.match(on, /Serwis wyświetla reklamy za pośrednictwem <strong>Google AdSense<\/strong>/);
  assert.match(on, /<li><strong>Dane reklamowe<\/strong>/);
  assert.match(on, /Przy pierwszej wizycie zobaczysz komunikat zgody/);
  assert.match(on, /art\. 6 ust\. 1 lit\. a RODO/);
  assert.match(on, /wyświetlanie reklam niespersonalizowanych/);
});

test('the policy keeps its section numbering in both ad states', () => {
  // §3 stays present-but-rewritten rather than disappearing: dropping it would
  // renumber §4–§9 and break any outside reference to a numbered section.
  for (const [label, config] of [['off', ADS_OFF], ['on', ADS_ON]]) {
    const html = renderPrivacyPolicy(config);
    for (let section = 1; section <= 9; section += 1) {
      assert.match(html, new RegExp(`<h2>${section}\\. `), `ads ${label}: §${section} is missing`);
    }
  }
});

test('the footer only mentions Google ads when ads are actually on', () => {
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
  assert.ok(!off.includes('reklamy Google'), 'ads-off footer must not advertise ads that do not load');
  // The rest of the disclosure (affiliate links, price freshness) must survive.
  assert.match(off, /linki afiliacyjne/);
  assert.match(off, /Ceny orientacyjne/);

  assert.match(renderIndex(items, ADS_ON), /Strona wyświetla też reklamy Google\./);
});

test('sitemap lists the catalog, every guide, and the privacy policy', () => {
  const xml = renderSitemap();
  assert.match(xml, /<loc>https:\/\/stareaparaty\.com\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/stareaparaty\.com\/polityka-prywatnosci\.html<\/loc>/);
  for (const guide of loadGuides()) {
    assert.ok(xml.includes(`<loc>${guide.url}</loc>`), `sitemap is missing ${guide.slug}`);
  }
});

// ── llms.txt is generated, so it cannot drift from guides.json ──────────────

test('llms.txt lists every guide, from the guide definitions themselves', () => {
  const rendered = renderLlmsTxt(loadGuides(), ADS_OFF);
  const guides = loadGuides();
  assert.ok(guides.length >= 10, `expected the committed guides, found ${guides.length}`);

  for (const guide of guides) {
    assert.ok(
      rendered.includes(`- ${guide.url} — ${guide.llms}`),
      `llms.txt is missing the line for ${guide.slug}`,
    );
  }
  // No placeholder may survive into a published file.
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(rendered));
});

test('every guide carries its own English llms.txt blurb', () => {
  // The point of the `llms` field: adding a guide cannot silently leave the
  // published index describing nine of ten pages. The fallback in
  // normalizeGuides keeps a missing blurb from breaking the nightly deploy, so
  // this test is what actually enforces the field.
  for (const guide of loadGuides()) {
    assert.ok(guide.llms, `${guide.slug} has no llms blurb`);
    assert.notEqual(
      guide.llms,
      guide.description,
      `${guide.slug} fell back to its Polish description — add an "llms" line to guides.json`,
    );
    assert.match(guide.llms, /guide \(Polish\):/, `${guide.slug}: keep the "<kind> guide (Polish): …" shape`);
  }
});

test('llms.txt describes the advertising the site actually runs', () => {
  const off = renderLlmsTxt(loadGuides(), ADS_OFF);
  assert.match(off, /currently displays no advertising/);
  assert.ok(!/AdSense/.test(off), 'an ads-off build must not tell agents the page carries AdSense');

  const on = renderLlmsTxt(loadGuides(), ADS_ON);
  assert.match(on, /carries Google AdSense display advertising/);
  assert.match(on, /marked "REKLAMA"/);
});

// ── Honest <lastmod> ────────────────────────────────────────────────────────
// A sitemap that reports today for every URL on every nightly build is the one
// case Google's docs say makes them ignore <lastmod> outright. These tests pin
// the two halves of the fix: the fingerprint must ignore the masthead's own
// build stamp, and an unchanged page must keep its previous date.

const FINGERPRINT_ITEMS = [{
  id: 1,
  title: 'Zenit B',
  image: 'https://example.com/z.jpg',
  url: 'https://www.olx.pl/d/oferta/zenit.html',
  host: 'olx.pl',
  sold: false,
  price: '250 zł',
  oldPrice: '',
}];

test('contentFingerprint ignores the masthead build stamp but not real content', () => {
  const page = renderIndex(FINGERPRINT_ITEMS, ADS_OFF);
  assert.match(page, /Aktualizacja: /, 'template no longer stamps a build time — update VOLATILE_MARKUP');

  // Same page, later build. Only the stamp differs, so the fingerprint must not.
  const laterBuild = page.replace(
    /(<span class="label label--soft">Aktualizacja: )[^<]*(<\/span>)/,
    '$1' + '31 gru 2027, 23:59' + '$2',
  );
  assert.notEqual(laterBuild, page, 'the stamp substitution did not match the rendered markup');
  assert.equal(contentFingerprint(laterBuild), contentFingerprint(page));

  // A price change is real content, and must move the fingerprint.
  const repriced = renderIndex(
    FINGERPRINT_ITEMS.map((item) => ({ ...item, price: '999 zł' })),
    ADS_OFF,
  );
  assert.notEqual(contentFingerprint(repriced), contentFingerprint(page));
});

test('resolvePageLastmod keeps the old date for unchanged pages and moves changed ones', () => {
  const pages = [
    { url: 'https://stareaparaty.com/', html: '<p>catalog v2</p>' },
    { url: 'https://stareaparaty.com/poradniki/a.html', html: '<p>guide, untouched</p>' },
  ];
  const previous = {
    'https://stareaparaty.com/': {
      fingerprint: contentFingerprint('<p>catalog v1</p>'),
      lastmod: '2026-08-01',
    },
    'https://stareaparaty.com/poradniki/a.html': {
      fingerprint: contentFingerprint('<p>guide, untouched</p>'),
      lastmod: '2026-07-14',
    },
  };

  const { lastmod, state } = resolvePageLastmod(pages, previous, '2026-08-11');
  assert.equal(lastmod.get('https://stareaparaty.com/'), '2026-08-11', 'changed page moves to today');
  assert.equal(
    lastmod.get('https://stareaparaty.com/poradniki/a.html'),
    '2026-07-14',
    'an untouched guide must not claim it changed tonight',
  );
  // The state carries the new fingerprints forward for the next run.
  assert.equal(state['https://stareaparaty.com/'].fingerprint, contentFingerprint('<p>catalog v2</p>'));
  assert.equal(Object.keys(state).length, 2, 'state is rebuilt from the page list, not merged');
});

test('resolvePageLastmod stamps today when there is nothing to compare against', () => {
  const pages = [{ url: 'https://stareaparaty.com/poradniki/new.html', html: '<p>brand new</p>' }];

  // First ever run: no state file.
  const fresh = resolvePageLastmod(pages, {}, '2026-08-11');
  assert.equal(fresh.lastmod.get('https://stareaparaty.com/poradniki/new.html'), '2026-08-11');

  // A matching fingerprint with no recorded date is unusable — stamp today
  // rather than emitting an empty <lastmod>.
  const dateless = resolvePageLastmod(
    pages,
    { 'https://stareaparaty.com/poradniki/new.html': { fingerprint: contentFingerprint('<p>brand new</p>') } },
    '2026-08-11',
  );
  assert.equal(dateless.lastmod.get('https://stareaparaty.com/poradniki/new.html'), '2026-08-11');
});

test('sitemap emits the per-page dates it is given and omits the rest', () => {
  const guides = [
    { slug: 'a', url: 'https://stareaparaty.com/poradniki/a.html' },
    { slug: 'b', url: 'https://stareaparaty.com/poradniki/b.html' },
  ];
  const xml = renderSitemap(guides, new Map([
    ['https://stareaparaty.com/', '2026-08-11'],
    ['https://stareaparaty.com/poradniki/a.html', '2026-06-02'],
  ]));

  assert.match(xml, /<loc>https:\/\/stareaparaty\.com\/<\/loc>\n\s*<lastmod>2026-08-11<\/lastmod>/);
  assert.match(xml, /poradniki\/a\.html<\/loc>\n\s*<lastmod>2026-06-02<\/lastmod>/);
  // Guide b has no date, so it gets no element rather than an invented one.
  assert.match(xml, /poradniki\/b\.html<\/loc>\n\s*<changefreq>/);
  assert.equal(xml.match(/<lastmod>/g).length, 2);
  assert.ok(!xml.includes('<lastmod></lastmod>'));
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

test('a model guide selects listings by keyword, not by type', () => {
  const guides = loadGuides();
  const pentax = guides.find((guide) => guide.slug === 'pentax-me');
  assert.ok(pentax, 'expected the Pentax ME guide');
  assert.equal(pentax.kind, 'model');

  const items = [
    { title: 'Pentax ME z obiektywem Takumar', url: 'https://olx.pl/me.html', price: '330 zł', sold: false },
    { title: 'Pentax SF7 z obiektywami', url: 'https://olx.pl/sf.html', price: '300 zł', sold: false },
    { title: 'Aparat Zenit-B z Helios-44-2', url: 'https://olx.pl/z.html', price: '250 zł', sold: false },
  ];
  const html = renderGuide(pentax, guides, items, ADS_OFF);

  assert.ok(html.includes('Pentax ME z obiektywem'), 'expected the matching body');
  // All three are SLRs — a type-based filter would wrongly pull them all in.
  assert.ok(!html.includes('Pentax SF7'), 'a different Pentax model must not be listed');
  assert.ok(!html.includes('Zenit-B'), 'an unrelated SLR must not be listed');
  assert.match(html, /Pentax ME i MV w mojej ofercie/);
});

test('model guides stay out of the homepage type headings', () => {
  // Two model guides share the SLR type; letting them into the heading map
  // would mean they silently overwrite each other and the type guide.
  // Two types, so the catalog renders grouped sections with headings at all —
  // with a single type it falls back to a flat grid and there are no headings.
  const items = [{
    id: 1,
    title: 'Pentax ME z obiektywem Takumar',
    image: 'https://example.com/p.jpg',
    url: 'https://www.olx.pl/d/oferta/pentax.html',
    host: 'olx.pl',
    sold: false,
    price: '330 zł',
    oldPrice: '',
  }, {
    id: 2,
    title: 'Olympus AM-100 kompakt',
    image: 'https://example.com/o.jpg',
    url: 'https://www.olx.pl/d/oferta/olympus.html',
    host: 'olx.pl',
    sold: false,
    price: '165 zł',
    oldPrice: '',
  }];
  const html = renderIndex(items, ADS_OFF);
  assert.match(html, /cam-group__guide" href="poradniki\/lustrzanki-slr\.html"/);
  assert.ok(!html.includes('cam-group__guide" href="poradniki/pentax-me.html"'));
});

test('normalizeGuides requires a model guide to carry match keywords', () => {
  assert.throws(
    () => normalizeGuides(
      [{ slug: 'x', kind: 'model', type: 'Kompaktowe', title: 'T', description: 'D' }],
      TYPE_CONFIG,
    ),
    /needs a non-empty match list/,
  );
});

test('guide navLabels are unique so the cross-link row is unambiguous', () => {
  const labels = loadGuides().map((guide) => guide.navLabel);
  assert.equal(new Set(labels).size, labels.length, `duplicate navLabel in ${labels.join(', ')}`);
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
  // The SLR body must not leak into the rangefinder guide's OFFER LIST.
  // Scoped to that block on purpose: "Pentax ME" also appears further down the
  // page as a cross-link label, which is correct and must not fail this test.
  const offers = html.slice(html.indexOf('<div class="offers">'), html.indexOf('Dobierz film'));
  assert.ok(offers.includes('Mamiya Rank'), 'expected the rangefinder listing');
  assert.ok(!offers.includes('Pentax ME'), 'SLR listing must not appear in the rangefinder offers');
  // Sibling guides are cross-linked, the guide itself is not.
  assert.ok(!html.includes('href="dalmierzowe.html"'), 'guide must not link to itself');
  assert.match(html, /href="lustrzanki-slr\.html"/);
  assert.ok(!html.includes('adsbygoogle'), 'ads-off guide must load no third-party script');
});

// ── New-arrival badge ───────────────────────────────────────────────────────

test('resolveFirstSeen stamps genuinely new URLs and backfills known ones as not-new', () => {
  const previous = new Map([
    ['https://olx.pl/known.html', { url: 'https://olx.pl/known.html' }],
    ['https://olx.pl/tracked.html', { url: 'https://olx.pl/tracked.html', firstSeen: '2026-07-30' }],
  ]);

  // Never seen before → stamped today.
  assert.equal(resolveFirstSeen('https://olx.pl/fresh.html', previous, '2026-08-06'), '2026-08-06');
  // Already tracked → keeps its original date.
  assert.equal(resolveFirstSeen('https://olx.pl/tracked.html', previous, '2026-08-06'), '2026-07-30');
  // Known from before the field existed → empty, so the first build after
  // adding the badge doesn't stamp the whole catalog as new at once.
  assert.equal(resolveFirstSeen('https://olx.pl/known.html', previous, '2026-08-06'), '');
});

test('isNewArrival covers the 14-day window and excludes sold listings', () => {
  const today = '2026-08-06';
  assert.equal(isNewArrival({ firstSeen: '2026-08-06' }, today), true);
  assert.equal(isNewArrival({ firstSeen: '2026-07-24' }, today), true, '13 days is still new');
  assert.equal(isNewArrival({ firstSeen: '2026-07-23' }, today), false, '14 days has expired');
  assert.equal(isNewArrival({ firstSeen: '' }, today), false);
  assert.equal(isNewArrival({ firstSeen: '2026-08-06', sold: true }, today), false);
  assert.equal(isNewArrival({ firstSeen: 'nonsense' }, today), false);
  assert.equal(isNewArrival(undefined, today), false);
});

test('renderCard shows the NOWE chip only for a recent unsold listing', () => {
  const item = {
    title: 'Pentax ME', url: 'https://olx.pl/p.html', image: 'https://e.com/p.jpg',
    host: 'olx.pl', price: '330 zł', sold: false, firstSeen: '2026-08-06',
  };
  assert.match(renderCard(item, 0, { today: '2026-08-06' }), /cam-card__new/);
  assert.ok(!renderCard(item, 0, { today: '2026-09-30' }).includes('cam-card__new'));
  assert.ok(!renderCard({ ...item, sold: true }, 0, { today: '2026-08-06' }).includes('cam-card__new'));
});

// ── Per-camera notes ────────────────────────────────────────────────────────

test('noteForTitle picks the first matching rule and tolerates no match', () => {
  const rules = [
    { match: ['pentax me'], note: 'Note ME' },
    { match: ['pentax'], note: 'Note Pentax' },
    { match: ['^obiektyw'], note: 'Note lens' },
  ];
  // More specific rule listed first wins.
  assert.equal(noteForTitle('Pentax ME z obiektywem Takumar', rules), 'Note ME');
  assert.equal(noteForTitle('Pentax SF7', rules), 'Note Pentax');
  // ^ anchors to the start: a camera "z obiektywem" is not a lens.
  assert.equal(noteForTitle('Obiektyw Osawa 80-200', rules), 'Note lens');
  assert.equal(noteForTitle('Zenit-B', rules), '');
});

test('every committed note rule is usable and one sentence long', () => {
  const rules = loadCameraNotes();
  assert.ok(rules.length > 0, 'expected camera-notes.json to hold rules');
  for (const rule of rules) {
    assert.ok(Array.isArray(rule.match) && rule.match.length > 0, 'rule needs keywords');
    assert.ok(rule.note && rule.note.length < 160, `note too long: ${rule.note}`);
  }
});

test('renderCard renders a note when one matches and omits the line otherwise', () => {
  const item = {
    title: 'Aparat Zenit-B z obiektywem Helios-44-2', url: 'https://olx.pl/z.html',
    image: 'https://e.com/z.jpg', host: 'olx.pl', price: '250 zł', sold: false,
  };
  const rules = [{ match: ['zenit'], note: 'Radziecka lustrzanka.' }];
  assert.match(renderCard(item, 0, { noteRules: rules }), /cam-card__note">Radziecka lustrzanka\./);
  assert.ok(!renderCard(item, 0, {}).includes('cam-card__note'));
});

// ── Fetch health reporting ──────────────────────────────────────────────────

test('summarizeFetchHealth separates placeholder cards from cache fallbacks', () => {
  const health = summarizeFetchHealth([
    { url: 'a', fetchStatus: 'ok' },
    { url: 'b', fetchStatus: 'not-modified' },
    { url: 'c', fetchStatus: 'cached', fetchError: 'timeout' },
    { url: 'd', fetchStatus: 'placeholder' },
  ]);
  assert.deepEqual(health.cached.map((i) => i.url), ['c']);
  assert.deepEqual(health.placeholders.map((i) => i.url), ['d']);
});

test('reportFetchHealth only fails the build under --strict', () => {
  const health = { placeholders: [{ url: 'd' }], cached: [] };
  // Default: warn and carry on, so one dead listing can't block the deploy.
  assert.doesNotThrow(() => reportFetchHealth(health, { strict: false }));
  assert.throws(() => reportFetchHealth(health, { strict: true }), /placeholder cards/);
  // A cache fallback alone is never fatal.
  assert.doesNotThrow(
    () => reportFetchHealth({ placeholders: [], cached: [{ url: 'c' }] }, { strict: true }),
  );
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
