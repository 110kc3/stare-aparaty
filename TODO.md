# TODO

Ideas to improve Stare Aparaty. Ordered roughly by impact-per-effort within each section. None of these are committed to — treat this as a backlog to cherry-pick from.

## Revenue & conversion

- [ ] **Specific ASINs for the accessories section.** The three links under "Akcesoria" still go to Amazon search pages (`/s?k=...`). Search-result clicks convert far worse than product-page clicks. Pick one good item per category (strap, bag, film cartridge) and link to its `/dp/{ASIN}` page, same as the film section.
- [ ] **Track affiliate click-through.** Drop in Plausible, GoatCounter, or GA4 and fire a `click` event with the camera/product name. Without this it's impossible to tell which listings or film cards are actually pulling weight.
- [ ] **Show listing price on camera cards.** The OLX listing page already contains the price in its meta / JSON-LD — extend `build-catalog.js` to pull it and render as a small chip on the card. Lets visitors pre-qualify before clicking out.

## Discoverability / SEO

- [ ] **Open Graph + Twitter card meta.** Currently if someone shares `stare-aparaty` on Messenger/FB/Slack, the preview is blank. Add `og:title`, `og:description`, `og:image` (a branded hero image), `og:url`, `twitter:card=summary_large_image` to the template `<head>`.
- [ ] **Favicon + apple-touch-icon + web manifest.** Tab icon is currently the browser default. A simple pixelated camera icon would carry the retro vibe. Also unlocks "add to home screen" if a manifest is added.
- [ ] **`robots.txt` + `sitemap.xml`.** Static, tiny, and a free SEO win. The site has only one canonical URL so the sitemap is ~6 lines.
- [ ] **Product JSON-LD.** Each camera card could emit `Product` / `Offer` structured data (price, availability, image, URL). Enables rich results in Google Shopping tabs.

## UX polish

- [ ] **`loading="lazy"` on images.** The catalog fetches a lot of large OLX/Lomography images up front. Lazy-loading below-the-fold images speeds up initial paint on mobile.
- [ ] **Preload the two Google Fonts stylesheets.** Or — safer — self-host Inter + Cormorant Garamond + Press Start 2P under `fonts/` with `woff2` and `font-display: swap`. Removes a third-party render-blocking request.
- [ ] **Lightbox for camera photos.** Film cards already have a click-to-zoom. Cameras don't — clicking the image goes straight to OLX. Offering a quick zoom on the camera image lets visitors inspect wear/condition without leaving the page.
- [ ] **Respect `prefers-reduced-motion`.** The `.retro` hover state animates a `translate` on buttons — wrap those transitions in `@media (prefers-reduced-motion: no-preference)`.
- [ ] **Keyboard focus styles.** The custom `box-shadow: 0 10px 24px` on buttons blows away the browser's default focus ring. Add an explicit `:focus-visible` outline (2px solid `var(--accent)`, 2px offset).
- [ ] **Group cameras by type (SLR / Rangefinder / Compact / Instant).** Once the list grows past ~10 items a single grid starts feeling like a pile. Section headings mirror the B&W / Kolorowe split in the film area. (The grid itself already shows 4 per row with a centered short last row, so all discovered cameras display.)

## Build & workflow

- [ ] **Fix Amazon price scraper (currently disabled).** `scripts/refresh-amazon.js` works for the first product page after a warmup, then Amazon serves a captcha on every subsequent request — even with `--disable-blink-features=AutomationControlled`, patched webdriver/plugins/languages, a real viewport, and a ~10–18 s jittered delay between requests. The workflow file is parked at `.github/workflows/refresh-amazon.yml.disabled` so GitHub Actions skips it. Likely paths forward: (a) move to the Amazon Product Advertising API once Associates approves the account — the only ratelimit-friendly official channel; (b) route through a residential proxy pool (paid, but defeats per-IP fingerprinting); (c) try `playwright-extra` + `puppeteer-extra-plugin-stealth` for a stronger fingerprint patch than the in-house version; (d) drop the auto-refresh entirely and just keep a manual `node scripts/refresh-amazon.js` for ad-hoc local runs from a fresh IP. Until then, prices are hand-edited in `scripts/amazon-products.json` and the footer's "sprawdzone" date moves with each manual edit.
- [ ] **Hands-off price refresh via Amazon Product Advertising API (PA-API).** The fully unattended, captcha-proof, ToS-clean replacement for the disabled Playwright scraper — option (a) above, fleshed out. Prereq: an approved Amazon Associates account (the `blueprintkc0a-21` tag is already live on the site) plus a PA-API access key, secret key, and partner tag. Implementation: store `AMAZON_ACCESS_KEY` / `AMAZON_SECRET_KEY` / `AMAZON_PARTNER_TAG` as GitHub Actions secrets; rewrite `scripts/refresh-amazon.js` to call PA-API `GetItems` instead of scraping (ItemIds = the ASIN keys in `scripts/amazon-products.json`; Resources = `Offers.Listings.Price`, `Offers.Listings.Availability.Message`, `ItemInfo.Title`, `Images.Primary.Large`). Map the response back into `amazon-products.json` (price, lastChecked, image) and — crucially — when an item returns **no buy-box Offer** (the Fujifilm Acros `B085R9RN6F` failure mode), flag it for manual replacement instead of writing a stale price. Then rename `.github/workflows/refresh-amazon.yml.disabled` → `.yml` and let its weekly cron commit + push so Pages redeploys. Notes: `GetItems` batches up to 10 ASINs per call (the current catalogue fits in two calls), default throttle is ~1 request/s, and Amazon requires ≥3 qualifying sales every 180 days to keep API access alive. Until this lands, the weekly Cowork task `stare-aparaty-price-check` refreshes prices through a real browser session as the interim bridge.
- [ ] **Validate discovered URLs in the workflow.** Fail (or warn) the job early if any discovered listing returns non-2xx instead of silently rendering a placeholder card.
- [ ] **Cache OLX fetches in the runner.** `actions/cache` keyed on the URL list — skip refetching for URLs whose content didn't change. Speeds up the CI run and reduces load on OLX.
- [ ] **ESLint + Prettier on `scripts/`.** One file, one config — low effort, prevents style drift if the build script grows.
- [ ] **Lighthouse CI on pull requests.** Budget for performance/accessibility/best-practices. Catches regressions like "we accidentally loaded a 4MB hero image" before they ship.

## Nice-to-have / someday

- [ ] **Per-camera history blurb.** One sentence per card — era, country, notable feature. Adds character without turning into a wiki.
- [ ] **"New arrivals" badge.** Cameras added in the last 14 days get a small `NOWE` chip in the corner. Data already available from `olx_meta.json` if we stamp it.
- [ ] **Pixelate-on-hover effect.** As a visual Easter egg, apply a CSS `filter` that bumps the pixelation on hover. Fits the retro theme; zero practical value.
