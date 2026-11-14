# Stare Aparaty

Static catalog and affiliate showcase for my own vintage analog cameras listed on OLX alongside curated film stocks and photography accessories on Allegro. The public copy is in Polish; code and this README are in English.

Live Website: https://stareaparaty.com/ (GitHub Pages)

## Highlights

- **Automated Listing Discovery:** Crawls OLX seller pages, parses Open Graph/JSON-LD metadata, and normalizes listing cards
- **Allegro Affiliate Integration:** Campaign links for 15 curated film stocks and accessories; prices are maintained by hand in `scripts/allegro-products.json` (the weekly API refresh workflow skips without Allegro credentials)
- **Guide Generator:** Programmatically builds 12 buyer guides (`poradniki/`) cross-linked directly to active camera listings
- **Zero-Dependency Native Tests:** Comprehensive suite covering metadata extraction, ad-state gating, HTML generation, and sitemap lastmod fidelity

## Quick Start

No install step: the scripts and tests use only Node's built-in modules (Node 20+).

```bash
node --test
npx --yes eslint@9 .
node scripts/discover-listings.js
node scripts/build-catalog.js
python -m http.server 8000 --bind 127.0.0.1
```

`discover-listings.js` rewrites `product-links.txt` from my OLX user page (`--dry-run` writes nothing; `--allow-shrink` accepts a drop of more than 30%). `build-catalog.js` fetches each listing and regenerates `index.html`, `olx_meta.json`, `polityka-prywatnosci.html`, `poradniki/*.html`, `sitemap.xml`, `ads.txt`, `llms.txt` and `llms-full.txt`. Those are build output and are never hand-edited: change `templates/` or the JSON in `scripts/` and rebuild. `test/links.test.js` checks the committed HTML, so rebuild after editing a template.

AdSense ships disabled (`enabled: false` in `scripts/ads-config.json`): the build emits no ad markup and loads no third-party script. Flipping the flag changes the published privacy policy, so `PRIVACY_UPDATED` in `scripts/build-catalog.js` must be bumped at the same time; see `ADSENSE.md`.

## Documentation

- [Accepted Worklist](TODO.md)
- [Monetization & AdSense Setup](ADSENSE.md)
- [Growth Plan](GROWTH-PLAN.md)
- [LLM Discovery Manifest](llms.txt)
