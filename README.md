# Stare Aparaty

Retro-styled static website for showcasing vintage camera listings. The website content itself is in Polish, while the code and documentation are in English.

## Overview

This project is prepared for **GitHub Pages**, not AWS.

You only provide product links, and the automation rebuilds the full cameras page for you. The generated output includes:

- `index.html` - the published static page
- `olx_meta.json` - normalized product metadata

The Amazon section on the page is preserved and left untouched as requested.

## Update flow

1. Open the **GitHub Actions** tab in the repository.
2. Run the **Update cameras from links** workflow.
3. Paste the complete list of product links, one per line.
4. The workflow fetches metadata from each link and regenerates the catalog.
5. The workflow commits the new generated files.
6. GitHub Pages deploys the refreshed version automatically.

If you remove a link from the workflow input, that product disappears from the page after the next rebuild.

## Project structure

- `index.html` - generated static page published on GitHub Pages
- `olx_meta.json` - generated camera metadata
- `product-links.txt` - saved source list of links
- `retro.css` - retro font and pixel-image helpers
- `styles.css` - main layout and retro UI styles
- `templates/index.template.html` - HTML template for page generation
- `scripts/build-catalog.js` - catalog generator script
- `.github/workflows/update-products.yml` - manual workflow for refreshing products
- `.github/workflows/deploy-pages.yml` - GitHub Pages deployment workflow

## Local usage

### Rebuild from saved links

```bash
node scripts/build-catalog.js
```

### Rebuild from links passed directly

```bash
node scripts/build-catalog.js --links "https://example.com/item-1\nhttps://example.com/item-2" --write-links-file
```

### Preview locally

```bash
python -m http.server 8000 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8000`.

## Metadata extraction

The generator tries common metadata sources from each listing page:

- Open Graph tags like `og:title` and `og:image`
- Twitter card tags like `twitter:title` and `twitter:image`
- JSON-LD blocks
- The regular HTML `<title>` tag as fallback

## GitHub Pages setup

1. Push the repository to GitHub.
2. In repository settings, enable **GitHub Pages** with **GitHub Actions** as the source.
3. Use the workflows in `.github/workflows`.

## Notes

- Website copy remains in Polish.
- Code, scripts, and documentation remain in English.
- The Amazon section is intentionally preserved.
