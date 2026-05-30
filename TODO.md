# TODO

Ideas to improve Stare Aparaty. Ordered roughly by impact-per-effort within each section. None of these are committed to — treat this as a backlog to cherry-pick from.

## Revenue & conversion

- [ ] **Specific ASINs for the accessories section.** The three links under "Akcesoria" still go to Amazon search pages (`/s?k=...`). Search-result clicks convert far worse than product-page clicks. Pick one good item per category (strap, bag, film cartridge) and link to its `/dp/{ASIN}` page, same as the film section.
- [x] **Add a film-developing / scanning block.** A home-dev kit and a basic film scanner are natural upsells for anyone buying a vintage camera. One extra 2–4 item row under the existing sections. *(Done — "Wywoływanie i skanowanie" section with Rodinal, Ilford Rapid Fixer, Kodak Slide N Scan, and the Kodak mobile scanner.)*
- [ ] **Track affiliate click-through.** Drop in Plausible, GoatCounter, or GA4 and fire a `click` event with the camera/product name. Without this it's impossible to tell which listings or film cards are actually pulling weight.
- [ ] **Show listing price on camera cards.** The OLX listing page already contains the price in its meta / JSON-LD — extend `build-catalog.js` to pull it and render as a small chip on the card. Lets visitors pre-qualify before clicking out.
- [x] **"Zarezerwowane" / "Sprzedane" state.** When a camera sells, mark the card visually (desaturated + label) instead of deleting it; gives returning visitors a sense that the site actually moves and avoids dead clicks. *(Done — auto-detected. When `build-catalog.js` fetches a listing and gets HTTP 410 or 404, the item is flagged `sold: true`; `renderCard` emits a non-clickable `<div class="cam-card cam-card--sold">` with a desaturated image and a rotated gold SPRZEDANE stamp. Sold state is sticky across rebuilds — transient fetch errors don't clear it.)*

## Discoverability / SEO

- [ ] **Open Graph + Twitter card meta.** Currently if someone shares `stare-aparaty` on Messenger/FB/Slack, the preview is blank. Add `og:title`, `og:description`, `og:image` (a branded hero image), `og:url`, `twitter:card=summary_large_image` to the template `<head>`.
- [ ] **Favicon + apple-touch-icon + web manifest.** Tab icon is currently the browser default. A simple pixelated camera icon would carry the retro vibe. Also unlocks "add to home screen" if a manifest is added.
- [ ] **`robots.txt` + `sitemap.xml`.** Static, tiny, and a free SEO win. The site has only one canonical URL so the sitemap is ~6 lines.
- [ ] **Product JSON-LD.** Each camera card could emit `Product` / `Offer` structured data (price, availability, image, URL). Enables rich results in Google Shopping tabs.
- [x] **Custom 404 page.** GitHub Pages picks up `404.html` automatically. Styled to match the site, with a link back to the catalog. *(Done — `404.html` at the repo root, dark default with gold accent, "Klatka nieznaleziona" copy and a link back to `/`.)*

## UX polish

- [ ] **`loading="lazy"` on images.** The catalog fetches a lot of large OLX/Lomography images up front. Lazy-loading below-the-fold images speeds up initial paint on mobile.
- [ ] **Preload the two Google Fonts stylesheets.** Or — safer — self-host Inter + Cormorant Garamond + Press Start 2P under `fonts/` with `woff2` and `font-display: swap`. Removes a third-party render-blocking request.
- [ ] **Lightbox for camera photos.** Film cards already have a click-to-zoom. Cameras don't — clicking the image goes straight to OLX. Offering a quick zoom on the camera image lets visitors inspect wear/condition without leaving the page.
- [ ] **Respect `prefers-reduced-motion`.** The `.retro` hover state animates a `translate` on buttons — wrap those transitions in `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Keyboard focus styles.** The custom `box-shadow: 0 10px 24px` on buttons blows away the browser's default focus ring. Add an explicit `:focus-visible` outline (2px solid `var(--accent)`, 2px offset).
- [ ] **Group cameras by type (SLR / Rangefinder / Compact / Instant).** Once the list grows past ~10 items a single flat grid starts feeling like a pile. Section headings mirror the B&W / Kolorowe split in the film area.

## Build & workflow

- [ ] **Fix Amazon price scraper (currently disabled).** `scripts/refresh-amazon.js` works for the first product page after a warmup, then Amazon serves a captcha on every subsequent request — even with `--disable-blink-features=AutomationControlled`, patched webdriver/plugins/languages, a real viewport, and a ~10–18 s jittered delay between requests. The workflow file is parked at `.github/workflows/refresh-amazon.yml.disabled` so GitHub Actions skips it. Likely paths forward: (a) move to the Amazon Product Advertising API once Associates approves the account — the only ratelimit-friendly official channel; (b) route through a residential proxy pool (paid, but defeats per-IP fingerprinting); (c) try `playwright-extra` + `puppeteer-extra-plugin-stealth` for a stronger fingerprint patch than the in-house version; (d) drop the auto-refresh entirely and just keep a manual `node scripts/refresh-amazon.js` for ad-hoc local runs from a fresh IP. Until then, prices are hand-edited in `scripts/amazon-products.json` and the footer's "sprawdzone" date moves with each manual edit.
- [ ] **`update-products.yml` append mode.** Currently pasting a link list *replaces* `product-links.txt`. Add a second workflow input (checkbox / dropdown) to *append* to the existing list, so adding one camera doesn't require re-pasting everything.
- [ ] **Validate URLs in the workflow.** Fail the job early if any input URL returns non-2xx instead of silently rendering a placeholder card.
- [ ] **Weekly cron rebuild.** A `schedule: cron: '0 8 * * 1'` trigger on `deploy-pages.yml` re-fetches metadata weekly, so stale OLX listings drop out automatically and the "Aktualizacja" stamp stays fresh. Combined with the delisted-link detector above this handles most catalog rot on its own.
- [ ] **Cache OLX fetches in the runner.** `actions/cache` keyed on the URL list — skip refetching for URLs whose content didn't change. Speeds up the CI run and reduces load on OLX.
- [ ] **ESLint + Prettier on `scripts/`.** One file, one config — low effort, prevents style drift if the build script grows.
- [ ] **Lighthouse CI on pull requests.** Budget for performance/accessibility/best-practices. Catches regressions like "we accidentally loaded a 4MB hero image" before they ship.

## Nice-to-have / someday

- [ ] **Per-camera history blurb.** One sentence per card — era, country, notable feature. Adds character without turning into a wiki.
- [ ] **"New arrivals" badge.** Cameras added in the last 14 days get a small `NOWE` chip in the corner. Data already available from `olx_meta.json` if we stamp it.
- [ ] **Pixelate-on-hover effect.** As a visual Easter egg, apply a CSS `filter` that bumps the pixelation on hover. Fits the retro theme; zero practical value.
