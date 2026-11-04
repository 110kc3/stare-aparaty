# Repository instructions — Stare Aparaty (stareaparaty.com)

Curated Polish marketplace and buyer's guide for vintage analogue cameras and film photography gear.
Read [README.md](README.md), [TODO.md](TODO.md), and [poradniki/](poradniki/) before modifying catalog generation or affiliate links.

## Source-of-truth rules

- `AGENTS.md` is canonical; `CLAUDE.md` must contain exactly the same bytes.
- Product data and affiliate mappings are managed in `scripts/allegro-products.json` and `olx_meta.json`.
- `TODO.md` tracks active backlog and completed milestone records.

## Architecture & components

- Dependency-free static site generator built on native Node.js APIs (`scripts/build-catalog.js`).
- Tests in `test/` run via native `node --test` without extra packages.
- Guides in `poradniki/` provide SEO content and buyer guides for camera types and specific models.
- Honest `<lastmod>` tracking in `sitemap.xml` using SHA-256 content fingerprints (`scripts/page-state.json`).

## Verification & commands

- Run unit test suite:
  ```bash
  node --test
  ```
- Run ESLint (correctness only):
  ```bash
  npx eslint@9 .
  ```
- Build catalog:
  ```bash
  node scripts/build-catalog.js
  ```
- All tests must pass before pushing commits to `main`.
