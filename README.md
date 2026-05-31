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
4. Publishes the result straight to GitHub Pages — no second workflow needed.

Discovery and deploy live in the same job on purpose: a push made with `GITHUB_TOKEN` can't trigger another workflow, and a self-contained run also avoids two workflows fighting over the shared `github-pages` concurrency group.

### `deploy-pages.yml` — publish to GitHub Pages (manual fallback)

Now `workflow_dispatch`-only. `discover-cameras.yml` owns automatic deploys; this one stays as an on-demand way to rebuild and publish the current files without re-scraping OLX. It checks out the repo, installs Node 20, runs `build-catalog.js`, and ships the directory as a Pages artifact. Shares the `github-pages` concurrency group.

### `refresh-amazon.yml` — refresh Amazon prices and product images

Triggered automatically every **Monday at 06:00 UTC** (and manually via `workflow_dispatch`). The job installs Playwright + Chromium on the runner, runs `scripts/refresh-amazon.js` for every ASIN listed in `scripts/amazon-products.json`, then commits the JSON if anything changed with the message `chore: refresh Amazon prices and images`.

The script:

- Pulls each `/dp/{ASIN}` page in a real headless browser with Polish locale + Warsaw timezone, so Amazon usually serves the regular product layout instead of a bot-check page.
- Extracts the current price via several fallback selectors (Amazon shuffles the price markup between PDP variants).
- For entries that already declare an `image` field (the developer + scanners — i.e. cards rendered with a real product photo), it also refreshes the `og:image` URL.
- Inserts a polite 2–4 second jittered delay between products and skips any ASIN where Amazon returns a CAPTCHA, leaving the previous value intact and stamping `lastFailed` so partial failures are visible.

That JSON commit lands on a watched path, so `deploy-pages.yml` picks it up and ships fresh prices to Pages without any manual rebuild. Films still use Lomography sample photos by design — the refresh script only touches `image` fields where they exist.

### How they chain

The normal flow for changing cameras is fully automatic:

```
schedule / push / manual fires discover-cameras.yml
  → discover-listings.js rewrites product-links.txt
    → build-catalog.js rebuilds index.html + olx_meta.json
      → same run publishes to GitHub Pages
```

The Amazon refresh flow runs on its own each week:

```
schedule fires refresh-amazon.yml
  → playwright scrapes Amazon, writes scripts/amazon-products.json
    → commit triggers deploy-pages.yml
      → build-catalog.js rewrites placeholders, Pages updates
```

For copy, styling, or template changes: push to one of the branches above and `discover-cameras.yml` rebuilds and redeploys (or run `deploy-pages.yml` manually).

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Generated static page published on GitHub Pages |
| `templates/index.template.html` | Source template with `{{COUNT}}`, `{{LAST_UPDATED}}`, `{{CAMERA_CARDS}}` placeholders |
| `scripts/discover-listings.js` | Auto-discovers my OLX offers and writes `product-links.txt` |
| `scripts/build-catalog.js` | Node script that fetches metadata and renders the template |
| `scripts/refresh-amazon.js` | Headless-browser scraper that updates Amazon prices + images in `amazon-products.json` |
| `scripts/amazon-products.json` | Source of truth for Amazon prices and (for dev/scanner cards) product images |
| `product-links.txt` | List of OLX camera URLs (generated by `discover-listings.js`) |
| `olx_meta.json` | Cached camera metadata (title / image / host) |
| `styles.css` | Main layout and visual styles |
| `retro.css` | Pixel-font kickers and pixelated-image helper (Polish diacritics fall through to Inter / Cormorant Garamond — see the comment at the top of the file) |
| `.github/workflows/discover-cameras.yml` | Scheduled/push workflow: auto-discover cameras, rebuild, and deploy |
| `.github/workflows/refresh-amazon.yml` | Weekly cron workflow to refresh Amazon prices and product images |
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

## GitHub Pages setup

In the repository settings, enable **Pages** with **GitHub Actions** as the source. That's all — the workflows handle the rest. The deploy action reports the live URL in the job summary.
