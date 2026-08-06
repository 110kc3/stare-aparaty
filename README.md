# Stare Aparaty

A small static site that lists my vintage cameras for sale on OLX alongside a curated selection of film stocks and accessories on Amazon. The site is hosted on GitHub Pages; the public copy is in Polish, the code and this README are in English.

## What the site is

- **Cameras section** — each card is generated from a live OLX listing URL. Title and cover image are fetched from the listing's metadata and the card links straight to the ad.
- **Film & accessories section** — hand-picked products on Amazon.pl. Every link carries the `blueprintkc0a-21` affiliate tag, so qualifying purchases support the site.

## How the build works

The camera list is produced in two steps:

1. `scripts/discover-listings.js` reads my OLX **user** page(s), keeps only my own active offers whose title matches a camera keyword, and writes the de-duplicated URLs to `product-links.txt`. This replaces the old "paste the links by hand" step.
2. `scripts/build-catalog.js` reads `product-links.txt`, fetches each listing's HTML, pulls a title and image from the page metadata (Open Graph, then Twitter cards, then JSON-LD, then the `<title>` tag as a last resort), and writes two files:

- `index.html` — the published page, rendered by filling in `templates/index.template.html`
- `olx_meta.json` — the normalized camera data, also used as a cache on the next run so that transient fetch failures fall back to the previously-known title/image instead of a placeholder

The camera grid shows **4 cards per row**; the build renders every discovered camera (no cap), and a short final row is centered rather than stretched. The film & accessories section lives inside the template and is fully static — the build script does not touch it.

### `scripts/discover-listings.js` — auto-discover my listings

```bash
node scripts/discover-listings.js            # update product-links.txt
node scripts/discover-listings.js --dry-run  # print what it found, write nothing
node scripts/discover-listings.js --out tmp.txt
```

The OLX user page is a client-rendered app, but it still ships the current page's listings as an escaped JSON blob in the HTML. The script collapses that escaping, reads `title` / `status` / `url` / owning `user.id` for each offer, paginates automatically until a page comes back empty, and keeps only offers that are mine (own `user.id`), `active`, and whose title contains a keyword. Config lives at the top of the file:

- `USER_PAGES` — my OLX user listing page(s); list only the first page of each, pagination is automatic. `categoryId=99` is the Foto category.
- `KEYWORDS` — the "is it actually a camera" filter (case-insensitive). Defaults to `aparat` / `analog` plus common analog-camera brands, since some cameras are titled by model only (e.g. *Pentax SF7*). Set to `[]` to keep every offer in the category.

## Workflows

The repo ships these GitHub Actions workflows:

### `discover-cameras.yml` — discover, rebuild, and publish (automatic)

The main workflow. Triggered on a **daily schedule** (`30 5 * * *`), on **push** to `main` / `master` / `update-film-info`, and manually via `workflow_dispatch`. In a single run it:

1. Runs `discover-listings.js` to regenerate `product-links.txt` from my OLX user page.
2. Runs `build-catalog.js` to rebuild `index.html` / `olx_meta.json`.
3. Commits those files (via `github-actions[bot]`) if anything changed.
4. Assembles a `dist/` folder of just the public files and publishes it straight to GitHub Pages — no second workflow needed. Only the public files ship; internal docs, scripts, and templates stay out of the deployed site.

Discovery and deploy live in the same job on purpose: a push made with `GITHUB_TOKEN` can't trigger another workflow, and a self-contained run also avoids two workflows fighting over the shared `github-pages` concurrency group.

### `deploy-pages.yml` — publish to GitHub Pages (manual fallback)

Now `workflow_dispatch`-only. `discover-cameras.yml` owns automatic deploys; this one stays as an on-demand way to rebuild and publish the current files without re-scraping OLX. It checks out the repo, installs Node 20, runs `build-catalog.js`, assembles a `dist/` folder containing only the public files, and ships that as a Pages artifact. Shares the `github-pages` concurrency group.

### `ci.yml` — run unit tests (automatic)

Runs on every pull request and on pushes to `main` / `master` / `update-film-info`. Executes `node --test`, which exercises the pure helpers in `scripts/build-catalog.js` and `scripts/discover-listings.js` (price/entity parsing, the OLX offer parsers, the rendered-output guard). No dependencies are installed — the scripts and tests use only Node's built-in modules.

### `refresh-amazon.yml` — refresh Amazon prices and product images

Currently disabled (`refresh-amazon.yml.disabled`). When enabled it runs weekly, drives `scripts/refresh-amazon.js` with Playwright + Chromium to update prices/images in `scripts/amazon-products.json`, and commits any changes.

### How they chain

The camera flow is fully automatic — discovery and publish happen in one run:

```
schedule / push / manual fires discover-cameras.yml
  → discover-listings.js rewrites product-links.txt
    → build-catalog.js rebuilds index.html + olx_meta.json
      → same run publishes to GitHub Pages
```

For copy, styling, or template changes: push to one of the branches above and `discover-cameras.yml` rebuilds and redeploys (or run `deploy-pages.yml` manually for an on-demand deploy).

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Generated static page published on GitHub Pages |
| `templates/index.template.html` | Source template. Placeholders: `{{COUNT}}`, `{{LAST_UPDATED}}`, `{{CAMERA_CARDS}}`, `{{CAMERA_JSONLD}}` (filled from OLX data), `{{PRICE_<ASIN>}}`, `{{IMAGE_<ASIN>}}`, `{{LAST_REFRESHED}}` (filled from `amazon-products.json`) and `{{ADSENSE_HEAD}}`, `{{AD_SLOT_MIDPAGE}}`, `{{AD_SLOT_INGRID}}`, `{{AD_SLOT_FOOTER}}` (filled from `ads-config.json`) |
| `templates/privacy.template.html` | Source template for the privacy policy — generated, not hand-written, so the AdSense publisher id lives in exactly one place |
| `polityka-prywatnosci.html` | Generated privacy & cookie policy, linked from the footer |
| `scripts/guides.json` | Prose for the buyer guides. Two kinds: a `type` guide owns a catalog section (its `type` must match `camera-types.json` — the build fails otherwise, so a renamed section can't orphan its guide) and is what the homepage headings link to; a `model` guide sits underneath one and picks its listings with a `match` keyword list, so it survives the specific camera selling |
| `templates/guide.template.html` | Shared shell for the guide pages |
| `poradniki/` | Generated guide pages (five per type, two per model). Each ends with the cameras it matches, live in the catalog on build day, so the guides feed the OLX listings instead of dead-ending |
| `scripts/discover-listings.js` | Auto-discovers my OLX offers and writes `product-links.txt` |
| `scripts/build-catalog.js` | Node script that fetches metadata and renders the template |
| `scripts/camera-types.json` | Keyword rules that sort cameras into on-page type sections (SLR / compact / …) |
| `scripts/camera-notes.json` | Keyword rules mapping a model to a one-sentence note (era, origin, notable feature) shown under the card title |
| `scripts/generate-icons.js` | Rasterizes `favicon.svg` into the PNG app icons (run when the favicon changes) |
| `scripts/fetch-fonts.js` | Downloads the self-hosted `woff2` fonts + generates `fonts/fonts.css` (run when the font set changes) |
| `fonts/` | Self-hosted Inter / Cormorant Garamond / Press Start 2P (`woff2`, latin + latin-ext) and `fonts.css` |
| `scripts/refresh-amazon.js` | Headless-browser scraper that updates Amazon prices + images in `amazon-products.json` |
| `scripts/amazon-products.json` | Source of truth for Amazon prices and (for dev/scanner cards) product images |
| `product-links.txt` | List of OLX camera URLs (generated by `discover-listings.js`) |
| `olx_meta.json` | Cached camera metadata (title / image / host / price / `firstSeen` for the NOWE chip / `etag` + `lastModified` for conditional refetching) |
| `eslint.config.mjs` | Flat ESLint config, correctness rules only. Run it the same way CI does: `npx --yes eslint@9 .` — nothing is installed into the repo |
| `.lighthouserc.json` | Lighthouse CI budget used by the `lighthouse` job on pull requests |
| `404.html` | Styled 404 page served by GitHub Pages |
| `favicon.svg`, `og-image.png` | Tab icon and social-share preview image |
| `apple-touch-icon.png`, `icon-192.png`, `icon-512.png` | Raster app icons (iOS home screen + PWA manifest), generated from `favicon.svg` |
| `site.webmanifest` | PWA manifest (name, theme color, icon) linked from the template `<head>` |
| `robots.txt`, `sitemap.xml` | SEO basics; both reference the `stareaparaty.com` domain |
| `scripts/ads-config.json` | The only AdSense knob — publisher id, per-slot ids, and an `enabled` flag. Ships **disabled**: with `enabled: false` the build emits no ad markup and loads no third-party script |
| `ads.txt` | Generated from `ads-config.json`; a comment-only placeholder while ads are off |
| `ADSENSE.md` | Runbook for the dashboard-side activation steps (approval, ad units, GDPR consent message) |
| `styles.css`, `retro.css`, `vintage_cameras.html` | Legacy hand-made page and its stylesheets. Not part of the generated site and no longer deployed — `index.html` carries all its styles inline in the template |
| `test/` | `node:test` unit tests for the build/discovery script helpers |
| `.github/workflows/ci.yml` | Three jobs: `node --test` on PRs and pushes, ESLint via `npx`, and Lighthouse CI on PRs only |
| `.github/workflows/discover-cameras.yml` | Scheduled/push workflow: auto-discover cameras, rebuild, and deploy |
| `.github/workflows/refresh-amazon.yml.disabled` | Weekly cron workflow to refresh Amazon prices and product images. **Disabled** (the `.disabled` suffix parks it so Actions skips it) — see TODO.md for why |
| `.github/workflows/deploy-pages.yml` | Manual fallback deploy workflow for GitHub Pages |

## Local usage

Refresh everything from my OLX user page, then rebuild:

```bash
node scripts/discover-listings.js
node scripts/build-catalog.js
```

Rebuild from the saved list only:

```bash
node scripts/build-catalog.js
```

Rebuild from an ad-hoc list (semicolons, newlines, or spaces all work) and persist it back to `product-links.txt`:

```bash
node scripts/build-catalog.js \
  --links "https://olx.pl/...;https://olx.pl/..." \
  --write-links-file
```

Preview locally:

```bash
python -m http.server 8000 --bind 127.0.0.1
# open http://127.0.0.1:8000
```

Run the unit tests (no dependencies needed — Node 20+):

```bash
node --test
```

## GitHub Pages setup

In the repository settings, enable **Pages** with **GitHub Actions** as the source. That's all — the workflows handle the rest. The deploy action reports the live URL in the job summary.

The site is configured for the custom domain **`stareaparaty.com`** (canonical URL, Open Graph tags, `sitemap.xml`, and `robots.txt` all point there). To make that domain serve the site: add the apex `A` records and a `www` `CNAME` at your DNS provider, then set the custom domain under **Settings → Pages** and enable **Enforce HTTPS**.
