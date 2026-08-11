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

It also regenerates `sitemap.xml`, `ads.txt`, `polityka-prywatnosci.html`, `llms.txt`, `llms-full.txt`, the ten guide pages under `poradniki/`, and `scripts/page-state.json` (see [honest `<lastmod>`](#honest-lastmod-in-the-sitemap) below).

**Generated files are never hand-edited.** `index.html`, `polityka-prywatnosci.html`, `poradniki/*.html`, `llms.txt`, `sitemap.xml` and `ads.txt` are all build output — edit the file in `templates/` (or the JSON in `scripts/`) and rebuild, or the next build discards the change.

### One flag decides what the site says about advertising

`scripts/ads-config.json` gates the AdSense loader, the four ad units and `ads.txt` — and, since 2026-08-11, every sentence that *describes* the ads:

| Surface | With `enabled: false` |
|---|---|
| Privacy policy §2 | no "Dane reklamowe" bullet |
| Privacy policy §3 | states that the site shows no ads, sets no cookies of its own, and therefore has no consent banner |
| Privacy policy §5 | consent is not listed as a legal basis |
| Privacy policy §8 | describes third-party cookies from OLX/Amazon/Allegro rather than ad personalization |
| Homepage footer | drops "Strona wyświetla też reklamy Google." |
| `llms.txt` | states that no advertising is displayed |

The ads-on wording is the previously reviewed text, kept verbatim, so flipping the flag restores the policy word for word. It is gated because the ad *markup* was already config-driven while the ad *prose* was not: an ads-off build published a policy claiming AdSense served ads and promised a consent message that never appeared. Flipping the flag changes the published policy, so `PRIVACY_UPDATED` must be bumped at the same time — see `ADSENSE.md`.

The camera grid shows **4 cards per row**; the build renders every discovered camera (no cap), and a short final row is centered rather than stretched. The film & accessories section lives inside the template and is fully static — the build script does not touch it.

### Honest `<lastmod>` in the sitemap

Every page is re-rendered on every nightly build, so "the build ran" and "this page changed" are different facts. The sitemap reports the second one.

Each generated page is fingerprinted (SHA-256 of its markup, with the masthead's own *Aktualizacja: …* build stamp stripped out — that byte changes nightly by itself). The fingerprint and the date it last moved are stored per URL in **`scripts/page-state.json`**, and that date is what `<lastmod>` carries. A guide whose prose and offer list are untouched keeps its old date; the day a listing sells and drops out of a guide's offer list, that guide's date advances.

This matters because Google's sitemap documentation says it ignores `<lastmod>` when the value isn't credible, and "today, on all twelve URLs, every night" is the textbook example. The state file is **build state, not site content**: it is committed (the next run needs it to compare against) but never copied into `dist/`. If it is ever deleted or corrupt, the build stamps every page with today's date and starts over — no failure, just one day of lost precision.

### `scripts/discover-listings.js` — auto-discover my listings

```bash
node scripts/discover-listings.js               # update product-links.txt
node scripts/discover-listings.js --dry-run     # print what it found, write nothing
node scripts/discover-listings.js --out tmp.txt
node scripts/discover-listings.js --allow-shrink # accept a big drop in listing count
```

The OLX user page is a client-rendered app, but it still ships the current page's listings as an escaped JSON blob in the HTML. The script collapses that escaping, reads `title` / `status` / `url` / owning `user.id` for each offer, paginates automatically until a page comes back empty, and keeps only offers that are mine (own `user.id`), `active`, and whose title contains a keyword. Config lives at the top of the file:

- `USER_PAGES` — my OLX user listing page(s); list only the first page of each, pagination is automatic. `categoryId=99` is the Foto category.
- `KEYWORDS` — the "is it actually a camera" filter (case-insensitive). Defaults to `aparat` / `analog` plus common analog-camera brands, since some cameras are titled by model only (e.g. *Pentax SF7*). Set to `[]` to keep every offer in the category.

Two guards protect `product-links.txt` from a bad scrape, because overwriting it with a short list quietly removes cameras from the live site. A run that finds **zero** offers leaves the file alone, and a run that loses more than **30%** of the previous list (`SHRINK_MAX_FRACTION`, floor of 5 links) refuses to write and exits non-zero — so the workflow stops before rebuilding and the deployed site keeps the last complete catalog. Pass `--allow-shrink` when you have genuinely removed a lot of listings.

## Workflows

The repo ships these GitHub Actions workflows:

### `discover-cameras.yml` — discover, rebuild, and publish (automatic)

The main workflow. Triggered on a **daily schedule** (`30 5 * * *`), on **push** to `main` / `master` / `update-film-info`, and manually via `workflow_dispatch`. In a single run it:

1. Runs `discover-listings.js` to regenerate `product-links.txt` from my OLX user page.
2. Runs `build-catalog.js` to rebuild `index.html` / `olx_meta.json`.
3. Stages the generated files and commits them (via `github-actions[bot]`) if anything is actually staged. It stages *before* testing for changes on purpose: `git diff` alone only sees tracked files, so a state file that is new on that run would read as "nothing changed" and never get committed.
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
| `scripts/guides.json` | Prose for the buyer guides. Two kinds: a `type` guide owns a catalog section (its `type` must match `camera-types.json` — the build fails otherwise, so a renamed section can't orphan its guide) and is what the homepage headings link to; a `model` guide sits underneath one and picks its listings with a `match` keyword list, so it survives the specific camera selling. Each guide also carries an `llms` one-line English summary, which is what the generated `llms.txt` publishes — a test fails if a guide is missing one, so a new guide can't ship undocumented |
| `templates/llms.template.txt` | Source of the generated `llms.txt`: hand-written prose plus `{{GUIDE_PAGES}}` (built from `guides.json`) and `{{ADS_NOTE}}` (from `ads-config.json`) |
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
| `robots.txt`, `sitemap.xml` | SEO basics; both reference the `stareaparaty.com` domain. The sitemap is generated, and its `<lastmod>` dates come from `scripts/page-state.json` |
| `scripts/page-state.json` | Per-URL content fingerprint + the date that content last changed, so `<lastmod>` doesn't claim every page changed on every build. Committed as build state; not deployed |
| `scripts/ads-config.json` | The only AdSense knob — publisher id, per-slot ids, and an `enabled` flag. Ships **disabled**: with `enabled: false` the build emits no ad markup and loads no third-party script |
| `ads.txt` | Generated from `ads-config.json`; a comment-only placeholder while ads are off |
| `ADSENSE.md` | Runbook for the dashboard-side activation steps (approval, ad units, GDPR consent message) |
| `styles.css`, `retro.css`, `vintage_cameras.html` | Legacy hand-made page and its stylesheets. Not part of the generated site and no longer deployed — `index.html` carries all its styles inline in the template |
| `test/` | `node:test` suites: `build-catalog.test.js` / `discover-listings.test.js` cover the script helpers, `links.test.js` crawls the generated HTML and fails on a broken internal link, anchor, canonical URL or sitemap entry |
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

Run the checks CI runs (no install step — both use only what's already available):

```bash
node --test                 # 82 tests: script helpers + generated-link integrity
npx --yes eslint@9 .        # correctness rules only, no formatting opinions
```

`test/links.test.js` reads the **committed** `index.html` / `poradniki/*.html` rather than rebuilding, so rebuild before running it if you have just edited a template — otherwise it is checking the previous build's output.

Run the unit tests (no dependencies needed — Node 20+):

```bash
node --test
```

## GitHub Pages setup

In the repository settings, enable **Pages** with **GitHub Actions** as the source. That's all — the workflows handle the rest. The deploy action reports the live URL in the job summary.

The site is configured for the custom domain **`stareaparaty.com`** (canonical URL, Open Graph tags, `sitemap.xml`, and `robots.txt` all point there). To make that domain serve the site: add the apex `A` records and a `www` `CNAME` at your DNS provider, then set the custom domain under **Settings → Pages** and enable **Enforce HTTPS**.
