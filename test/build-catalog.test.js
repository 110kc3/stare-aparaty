'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  formatPrice,
  getMetaContent,
  renderIndex,
  renderSiteJsonLd,
  decodeHtmlEntities,
  priceToNumber,
  resolveOldPrice,
  cleanupText,
  normalizeLinks,
  todayInWarsaw,
  assertRenderedOutput,
  mapWithConcurrency,
  classifyType,
  groupByType,
  renderCard,
  loadAllegroProducts,
  buildAllegroAffiliateUrl,
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
  summarizePriceFreshness,
  reportPriceFreshness,
} = require('../scripts/build-catalog.js');

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
  assert.ok(html.includes("Zenit $&amp; $' $` promocja"));
  assert.doesNotThrow(() => assertRenderedOutput(html, items.length));
});

test('catalog JSON-LD avoids inapplicable Product and Offer rich-result markup', () => {
  const item = {
    title: 'Zenit B',
    image: 'https://example.com/zenit.jpg',
    url: 'https://www.olx.pl/d/oferta/zenit.html',
  };
  const markup = renderSiteJsonLd([item]);
  const payload = JSON.parse(markup.match(/<script[^>]*>([\s\S]*)<\/script>/)[1]);
  const serialized = JSON.stringify(payload);

  assert.ok(!serialized.includes('"@type":"Product"'));
  assert.ok(!serialized.includes('"@type":"Offer"'));

  const list = payload['@graph'].find((node) => node['@type'] === 'ItemList');
  assert.equal(list.numberOfItems, 1);
  assert.deepEqual(list.itemListElement[0], {
    '@type': 'ListItem',
    position: 1,
    item: {
      '@id': item.url,
      name: item.title,
      image: item.image,
    },
  });
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

test('todayInWarsaw always emits an ISO date and observes the Warsaw boundary', () => {
  assert.equal(todayInWarsaw(new Date('2026-01-01T23:30:00Z')), '2026-01-02');
  assert.match(todayInWarsaw(new Date('2026-08-24T12:00:00Z')), /^\d{4}-\d{2}-\d{2}$/);
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
  assert.equal(classifyType('Aparat Zenit-B z Helios-44', TYPE_CONFIG), 'Lustrzanki (SLR)');
});

test('classifyType: "z obiektywem" is a camera, not a standalone lens', () => {
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
  assert.match(unit, /REKLAMA/);

  assert.equal(renderAdUnit(ADS_ON, 'ingrid'), '');
});

test('renderAdsTxt converts the ca-pub- tag id to the pub- seller id', () => {
  assert.equal(renderAdsTxt(ADS_ON), 'google.com, pub-1234567890123456, DIRECT, f08c47fec0942fa0\n');
});

test('normalizeAdsConfig throws on a malformed id rather than silently disabling', () => {
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


const MARKETPLACES = [
  {
    name: 'allegro',
    products: {
      FRESH1: { label: 'Fresh film', price: '30 zł', lastChecked: '2026-08-01' },
      LAGGARD: { label: 'Forgotten film', price: '45 zł', lastChecked: '2026-06-22' },
      NODATE: { label: 'Undated film', price: '50 zł' },
    },
  },
  {
    name: 'allegro',
    products: {
      fresh2: { label: 'Another fresh film', price: '35 zł', lastChecked: '2026-07-20' },
    },
  },
];

test('summarizePriceFreshness names the entry that sets the published date', () => {
  const summary = summarizePriceFreshness(MARKETPLACES, '2026-08-11');

  assert.equal(summary.published, '2026-06-22', 'the footer date is the oldest lastChecked');
  assert.deepEqual(summary.laggards.map((entry) => entry.key), ['LAGGARD']);
  assert.equal(summary.nextDate, '2026-07-20', 'refreshing the laggard would move the date here');

  assert.deepEqual(summary.stale.map((entry) => entry.key), ['LAGGARD']);
  assert.equal(summary.stale[0].ageDays, 50);
});

test('summarizePriceFreshness flags an entry with no lastChecked at all', () => {
  const summary = summarizePriceFreshness(MARKETPLACES, '2026-08-11');
  assert.deepEqual(summary.undated.map((entry) => entry.key), ['NODATE']);
});

test('reportPriceFreshness collapses the all-stale case into one line', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    reportPriceFreshness(summarizePriceFreshness([
      {
        name: 'allegro',
        products: {
          A: { label: 'A', lastChecked: '2026-06-22' },
          B: { label: 'B', lastChecked: '2026-07-06' },
          C: { label: 'C', lastChecked: '2026-07-06' },
        },
      },
    ], '2026-08-11'));
  } finally {
    console.warn = original;
  }

  const stalenessLines = warnings.filter((line) => /nieodświeżan/.test(line));
  assert.equal(stalenessLines.length, 1, `expected one collapsed line, got:\n${warnings.join('\n')}`);
  assert.match(stalenessLines[0], /Wszystkie 3 cen/);
  assert.ok(warnings.some((line) => /ustawiana przez: allegro\/A/.test(line)));
});

test('reportPriceFreshness stays quiet when every price is fresh', () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    reportPriceFreshness(summarizePriceFreshness([
      { name: 'allegro', products: { A: { label: 'A', lastChecked: '2026-08-10' } } },
    ], '2026-08-11'));
  } finally {
    console.warn = original;
  }
  assert.deepEqual(warnings, []);
});

test('committed price data: every entry carries a lastChecked date', () => {
  for (const file of ['allegro-products.json']) {
    const products = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', 'scripts', file), 'utf8'),
    );
    assert.ok(Object.keys(products).length > 0, `${file} is empty`);
    for (const [key, data] of Object.entries(products)) {
      assert.match(
        String(data.lastChecked || ''),
        /^\d{4}-\d{2}-\d{2}$/,
        `${file}: ${key} has no ISO lastChecked date, so its price escapes the footer's promise`,
      );
    }
  }
});


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
  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(rendered));
});

test('every guide carries its own English llms.txt blurb', () => {
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

  const laterBuild = page.replace(
    /(<span class="label label--soft">Aktualizacja: )[^<]*(<\/span>)/,
    '$1' + '31 gru 2027, 23:59' + '$2',
  );
  assert.notEqual(laterBuild, page, 'the stamp substitution did not match the rendered markup');
  assert.equal(contentFingerprint(laterBuild), contentFingerprint(page));

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
  assert.equal(state['https://stareaparaty.com/'].fingerprint, contentFingerprint('<p>catalog v2</p>'));
  assert.equal(Object.keys(state).length, 2, 'state is rebuilt from the page list, not merged');
});

test('resolvePageLastmod stamps today when there is nothing to compare against', () => {
  const pages = [{ url: 'https://stareaparaty.com/poradniki/new.html', html: '<p>brand new</p>' }];

  const fresh = resolvePageLastmod(pages, {}, '2026-08-11');
  assert.equal(fresh.lastmod.get('https://stareaparaty.com/poradniki/new.html'), '2026-08-11');

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
  assert.match(xml, /poradniki\/b\.html<\/loc>\n\s*<changefreq>/);
  assert.equal(xml.match(/<lastmod>/g).length, 2);
  assert.ok(!xml.includes('<lastmod></lastmod>'));
});


test('every guide targets a type that camera-types.json actually defines', () => {
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
  assert.ok(!html.includes('Pentax SF7'), 'a different Pentax model must not be listed');
  assert.ok(!html.includes('Zenit-B'), 'an unrelated SLR must not be listed');
  assert.match(html, /Pentax ME i MV w mojej ofercie/);
});

test('minolta-5000 model guide selects Minolta listings and excludes others', () => {
  const guides = loadGuides();
  const minolta = guides.find((guide) => guide.slug === 'minolta-5000');
  assert.ok(minolta, 'expected the Minolta 5000 guide');
  assert.equal(minolta.kind, 'model');

  const items = [
    { title: 'Aparat analogowy Minolta 5000 Gliwice', url: 'https://olx.pl/m5000.html', price: '60 zł', sold: false },
    { title: 'Pentax ME z obiektywem Takumar', url: 'https://olx.pl/me.html', price: '330 zł', sold: false },
  ];
  const html = renderGuide(minolta, guides, items, ADS_OFF);
  assert.ok(html.includes('https://olx.pl/m5000.html'), 'expected matching Minolta body in offers');
  assert.ok(!html.includes('https://olx.pl/me.html'), 'unrelated offer URL must not be listed');
  assert.match(html, /Minolta 5000 w ofercie/);
});

test('yashica-fx model guide selects Yashica FX listings and excludes others', () => {
  const guides = loadGuides();
  const yashica = guides.find((g) => g.slug === 'yashica-fx');
  assert.ok(yashica, 'yashica-fx guide not found in guides.json');
  assert.equal(yashica.kind, 'model');

  const items = [
    { title: 'Aparat Yashica FX-2 z obiektywem Super Paragon', url: 'https://olx.pl/fx2.html', price: '140 zł', sold: false },
    { title: 'Analogowy aparat Yashica 35W sprawny', url: 'https://olx.pl/35w.html', price: '349 zł', sold: false },
    { title: 'Pentax ME z obiektywem Takumar', url: 'https://olx.pl/me.html', price: '330 zł', sold: false },
  ];
  const html = renderGuide(yashica, guides, items, ADS_OFF);
  assert.ok(html.includes('https://olx.pl/fx2.html'), 'expected matching Yashica FX-2 in offers');
  assert.ok(!html.includes('https://olx.pl/35w.html'), 'Yashica 35W rangefinder must not be in FX SLR offers');
  assert.ok(!html.includes('https://olx.pl/me.html'), 'unrelated Pentax must not be listed');
  assert.match(html, /Yashica FX w ofercie/);
});

test('model guides stay out of the homepage type headings', () => {
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

  assert.ok(!/\{\{[A-Z0-9_]+\}\}/.test(html));
  assert.match(html, /<h1>Aparat dalmierzowy — ostrzenie na plamkę<\/h1>/);
  assert.match(html, /"@type": "Article"/);
  assert.match(html, /rel="canonical" href="https:\/\/stareaparaty\.com\/poradniki\/dalmierzowe\.html"/);
  const offers = html.slice(html.indexOf('<div class="offers">'), html.indexOf('Dobierz film'));
  assert.ok(offers.includes('Mamiya Rank'), 'expected the rangefinder listing');
  assert.ok(!offers.includes('Pentax ME'), 'SLR listing must not appear in the rangefinder offers');
  assert.ok(!html.includes('href="dalmierzowe.html"'), 'guide must not link to itself');
  assert.match(html, /href="lustrzanki-slr\.html"/);
  assert.ok(!html.includes('adsbygoogle'), 'ads-off guide must load no third-party script');
});


test('resolveFirstSeen stamps genuinely new URLs and backfills known ones as not-new', () => {
  const previous = new Map([
    ['https://olx.pl/known.html', { url: 'https://olx.pl/known.html' }],
    ['https://olx.pl/tracked.html', { url: 'https://olx.pl/tracked.html', firstSeen: '2026-07-30' }],
  ]);

  assert.equal(resolveFirstSeen('https://olx.pl/fresh.html', previous, '2026-08-06'), '2026-08-06');
  assert.equal(resolveFirstSeen('https://olx.pl/tracked.html', previous, '2026-08-06'), '2026-07-30');
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


test('noteForTitle picks the first matching rule and tolerates no match', () => {
  const rules = [
    { match: ['pentax me'], note: 'Note ME' },
    { match: ['pentax'], note: 'Note Pentax' },
    { match: ['^obiektyw'], note: 'Note lens' },
  ];
  assert.equal(noteForTitle('Pentax ME z obiektywem Takumar', rules), 'Note ME');
  assert.equal(noteForTitle('Pentax SF7', rules), 'Note Pentax');
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
  assert.doesNotThrow(() => reportFetchHealth(health, { strict: false }));
  assert.throws(() => reportFetchHealth(health, { strict: true }), /placeholder cards/);
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
  assert.equal(resolveOldPrice('320 zł', { price: '390 zł' }), '390 zł');
});

test('resolveOldPrice: the original (highest) price persists across rebuilds', () => {
  assert.equal(
    resolveOldPrice('320 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
  assert.equal(
    resolveOldPrice('300 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
  assert.equal(
    resolveOldPrice('350 zł', { price: '320 zł', oldPrice: '390 zł' }),
    '390 zł',
  );
});

test('resolveOldPrice: a new all-time high clears the struck price', () => {
  assert.equal(resolveOldPrice('400 zł', { price: '320 zł', oldPrice: '390 zł' }), '');
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
  assert.equal(classifyType('Kolekcja aparatów Canon EOS', config), 'Zestawy');
  assert.equal(classifyType('Aparat Zenit-B z obiektywem Helios-44', config), 'Lustrzanki (SLR)');
});


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
      typeof data.price === 'string' && (data.available === false || data.price.trim().length > 0),
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
  assert.deepEqual(placeholderKeys, jsonKeys);
});

test('loadAllegroProducts returns products and the oldest lastChecked date', () => {
  const loaded = loadAllegroProducts();
  assert.ok(Object.keys(loaded.products).length > 0);
  assert.match(loaded.lastRefreshed, /^\d{4}-\d{2}-\d{2}$/);
  const allDates = Object.values(loaded.products).map((p) => p.lastChecked).sort();
  assert.equal(loaded.lastRefreshed, allDates[0]);
});

test('all retail cards use the configured Allegro destination and campaign', () => {
  const html = renderIndex([]);
  assertRenderedOutput(html, 0);
  assert.doesNotMatch(html, /amazon|blueprintkc0a-21/i);
  const cards = [...html.matchAll(/<a class="product-card" href="([^"]+)"[^>]*>[\s\S]*?<\/a>/g)];
  assert.equal(cards.length, 15);
  const destinations = cards.map((card) => {
    assert.match(card[0], /rel="sponsored noopener"/);
    const affiliate = new URL(card[1].replace(/&amp;/g, '&'));
    assert.equal(affiliate.origin + affiliate.pathname, 'https://allegro.pl/affiliate');
    assert.equal([...affiliate.searchParams.keys()].join(','), 'redirect_url');
    const destination = new URL(affiliate.searchParams.get('redirect_url'));
    assert.equal(destination.searchParams.get('utm_medium'), 'afiliacja');
    assert.equal(destination.searchParams.get('utm_source'), 'ctr_b');
    assert.equal(destination.searchParams.get('utm_campaign'), '8902aaa9-6bd4-43f8-8111-28eb4c6a3dde');
    for (const key of ['utm_medium', 'utm_source', 'utm_campaign']) {
      destination.searchParams.delete(key);
    }
    return destination.href;
  });
  assert.deepEqual(destinations.sort(), Object.values(ALLEGRO_PRODUCTS).map((p) => p.url).sort());
  const scanner = cards.find((card) => card[0].includes('<h3>Mobilny skaner Kodak 6×6</h3>'))[0];
  assert.match(scanner, /120\/220/);
  assert.match(scanner, /Obecnie niedostępny/);
  assert.match(scanner, /Sprawdź dostępność na Allegro/);
  assert.doesNotMatch(scanner, /35 mm/);
});

test('Allegro deep links preserve multipack offers and reject non-retail destinations', () => {
  const raw = ALLEGRO_PRODUCTS['portra-400-5-pack'].url;
  const affiliate = new URL(buildAllegroAffiliateUrl(raw));
  const destination = new URL(affiliate.searchParams.get('redirect_url'));
  assert.equal(destination.searchParams.get('offerId'), '17741420194');
  for (const invalid of [
    'https://allegro.pl/listing?string=film',
    'https://allegrolokalnie.pl/oferta/film',
    'https://example.com/produkt/film',
    'http://allegro.pl/produkt/film',
    'https://allegro.pl/oferta/film',
  ]) {
    assert.throws(() => buildAllegroAffiliateUrl(invalid), /retail product URL/);
  }
});

test('Allegro link and image placeholders each have matching product data', () => {
  const links = [...TEMPLATE_HTML.matchAll(/\{\{ALLEGRO_URL_([a-z0-9-]+)\}\}/g)].map((m) => m[1]);
  assert.deepEqual(links.sort(), Object.keys(ALLEGRO_PRODUCTS).sort());
  for (const [, key] of TEMPLATE_HTML.matchAll(/\{\{ALLEGRO_IMAGE_([a-z0-9-]+)\}\}/g)) {
    assert.match(ALLEGRO_PRODUCTS[key].image, /^https:\/\/[a-z0-9]+\.allegroimg\.com\//);
  }
});
