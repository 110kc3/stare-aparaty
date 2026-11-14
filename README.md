# Stare Aparaty

Static catalog and affiliate showcase for vintage analog cameras listed on OLX alongside curated film stocks and photography accessories on Allegro.

Live Website: https://110kc3.github.io/stare-aparaty/

## Highlights

- **Automated Listing Discovery:** Crawls OLX seller pages, parses Open Graph/JSON-LD metadata, and normalizes listing cards
- **Allegro Affiliate Integration:** Synchronizes live product pricing and campaign links across 15 curated 35mm & 120 film stocks
- **Guide Generator:** Programmatically builds 10 detailed buyer guides (`poradniki/`) cross-linked directly to active camera listings
- **Zero-Dependency Native Tests:** Comprehensive suite covering metadata extraction, ad-state gating, HTML generation, and sitemap lastmod fidelity

## Quick Start

```bash
npm install
node --test test/*.test.js
node scripts/build-catalog.js
```

## Documentation

- [Accepted Worklist](TODO.md)
- [Monetization & AdSense Setup](ADSENSE.md)
- [Growth Plan](GROWTH-PLAN.md)
- [LLM Discovery Manifest](llms.txt)
