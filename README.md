# Stare Aparaty

A small static site that lists my vintage cameras for sale on OLX alongside a curated selection of film stocks and accessories on Amazon. The site is hosted on GitHub Pages; the public copy is in Polish, the code and this README are in English.

## What the site is

- **Cameras section** — each card is generated from a live OLX listing URL. Title and cover image are fetched from the listing's metadata and the card links straight to the ad.
- **Film & accessories section** — hand-picked products on Amazon.pl. Every link carries the `blueprintkc0a-21` affiliate tag, so qualifying purchases support the site.

## How the build works

Everything is rendered by `scripts/build-catalog.js`. It reads the camera URLs from `product-links.txt`, fetches each listing's HTML, pulls a title and image from the page metadata (Open Graph, then Twitter cards, then JSON-LD, then the `<title>` tag as a last resort), and writes two files:

- `index.html` — the published page, rendered by filling in `templates/index.template.html`
- `olx_meta.json` — the normalized camera data, also used as a cache on the next run so that transient fetch failures fall back to the previously-known title/image instead of a placeholder

The film & accessories section lives inside the template and is fully static — the build script does not touch it.

## Workflows

The repo ships three GitHub Actions workflows that work together:

### `update-products.yml` — refresh the camera list

Triggered **manually** from the Actions tab. It takes one input: a list of OLX links. You can separate them with semicolons (`;`), newlines, or spaces — semicolons are the cleanest option in the Actions UI because the form is single-line.

The job:

1. Saves the pasted input to a temp file.
2. Runs the builder with `--links-file workflow-links.txt --write-links-file`, which rebuilds `index.html` / `olx_meta.json` **and** overwrites `product-links.txt` with the normalized, de-duplicated list.
3. Commits `index.html`, `olx_meta.json`, and `product-links.txt` back to the branch with the message `chore: update camera catalog`, using the `github-actions[bot]` identity. If nothing changed it exits without committing.

That commit is what triggers the deploy step — the workflow itself does not publish anything to Pages.

### `deploy-pages.yml` — publish to GitHub Pages

Triggered automatically on push to `main`, `master`, or `update-film-info`, but only when one of the relevant paths changes (`index.html`, `olx_meta.json`, `templates/**`, `scripts/**`, `retro.css`, `styles.css`, `product-links.txt`, or either workflow file). Can also be run manually via `workflow_dispatch`.

The job checks out the repo, installs Node 20, runs `node scripts/build-catalog.js` again on the runner (so the deployed `index.html` always reflects the latest `product-links.txt` and template, even if someone forgot to rebuild locally), and ships the whole directory as a Pages artifact through `actions/deploy-pages`. A concurrency group (`github-pages`, `cancel-in-progress: true`) prevents overlapping deploys.

### `refresh-amazon.yml` — refresh Amazon prices and product images

Triggered automatically every **Monday at 06:00 UTC** (and manually via `workflow_dispatch`). The job installs Playwright + Chromium on the runner, runs `scripts/refresh-amazon.js` for every ASIN listed in `scripts/amazon-products.json`, then commits the JSON if anything changed with the message `chore: refresh Amazon prices and images`.

The script:

- Pulls each `/dp/{ASIN}` page in a real headless browser with Polish locale + Warsaw timezone, so Amazon usually serves the regular product layout instead of a bot-check page.
- Extracts the current price via several fallback selectors (Amazon shuffles the price markup between PDP variants).
- For entries that already declare an `image` field (the developer + scanners — i.e. cards rendered with a real product photo), it also refreshes the `og:image` URL.
- Inserts a polite 2–4 second jittered delay between products and skips any ASIN where Amazon returns a CAPTCHA, leaving the previous value intact and stamping `lastFailed` so partial failures are visible.

That JSON commit lands on a watched path, so `deploy-pages.yml` picks it up and ships fresh prices to Pages without any manual rebuild. Films still use Lomography sample photos by design — the refresh script only touches `image` fields where they exist.

### How they chain

The normal flow for changing cameras:

```
run update-products.yml (manual)
  → commit to branch
    → push triggers deploy-pages.yml
      → site updates on GitHub Pages
```

The Amazon refresh flow runs on its own each week:

```
schedule fires refresh-amazon.yml
  → playwright scrapes Amazon, writes scripts/amazon-products.json
    → commit triggers deploy-pages.yml
      → build-catalog.js rewrites placeholders, Pages updates
```

For copy, styling, or template changes: just commit to one of the watched branches — `deploy-pages.yml` picks it up and redeploys.

## Project structure

| Path | Purpose |
| --- | --- |
| `index.html` | Generated static page published on GitHub Pages |
| `templates/index.template.html` | Source template with `{{COUNT}}`, `{{LAST_UPDATED}}`, `{{CAMERA_CARDS}}` placeholders |
| `scripts/build-catalog.js` | Node script that fetches metadata and renders the template |
| `scripts/refresh-amazon.js` | Headless-browser scraper that updates Amazon prices + images in `amazon-products.json` |
| `scripts/amazon-products.json` | Source of truth for Amazon prices and (for dev/scanner cards) product images |
| `product-links.txt` | Source list of OLX camera URLs |
| `olx_meta.json` | Cached camera metadata (title / image / host) |
| `styles.css` | Main layout and visual styles |
| `retro.css` | Pixel-font kickers and pixelated-image helper (Polish diacritics fall through to Inter / Cormorant Garamond — see the comment at the top of the file) |
| `.github/workflows/update-products.yml` | Manual workflow to refresh cameras from pasted links |
| `.github/workflows/refresh-amazon.yml` | Weekly cron workflow to refresh Amazon prices and product images |
| `.github/workflows/deploy-pages.yml` | Auto-deploy workflow for GitHub Pages |

## Local usage

Rebuild from the saved list:

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
