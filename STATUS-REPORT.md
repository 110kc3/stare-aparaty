# Status Report — Bug Check & Future Steps Audit

*Generated 2026-06-13. Covers: full review of scripts, workflows, templates, generated output, and planning docs (TODO.md, GROWTH-PLAN.md).*
*Last refreshed 2026-08-06 — see "Session 6" below.*

> Note: bug #2 below (whole repo published as the Pages artifact) is fixed — internal docs like this file no longer ship to the live site.

## Change log (all 2026-06-13)

**Session 1 — contact email**
- Added **support@stareaparaty.com** to the page: a `Kontakt` link in the masthead nav and a `mailto:` line in the footer (`templates/index.template.html`), plus footer link styling. `index.html` regenerated.

**Session 2 — deploy hardening + domain**
- Fixed the `404.html` home link (finding #1) and switched both deploy workflows to a `dist/`-only artifact so internal docs/scripts/templates no longer publish (#2, also resolves the deploy half of #5).
- Migrated all site URLs (canonical, OG/Twitter, sitemap, robots, 404 link) to the `stareaparaty.com` custom domain (#3 — code side).

**Session 3 — docs accuracy**
- Aligned GROWTH-PLAN's GoatCounter instructions to the live `kc-it` account (#6); refreshed the stale README structure table, workflow name, placeholder list, and added the `dist/`/custom-domain docs (#7).

**Session 4 — code + a11y + housekeeping**
- `decodeHtmlEntities()` now decodes `&amp;` last, fixing double-decode of nested entities (#4).
- `formatPrice()` strips whitespace thousands separators before parsing, so prices like `1 234,56` no longer drop out (#10).
- Added `.gitattributes` (`* text=auto eol=lf`) to stop the recurring LF→CRLF warnings on generated files (#11).
- Added `:focus-visible` rings for keyboard navigation and a `prefers-reduced-motion` block to the template; `index.html` rebuilt (#12 + two TODO/UX items).

**Session 5 — SEO structured data + PWA manifest**
- Added schema.org **Product/Offer JSON-LD** for the whole camera catalog (`build-catalog.js` → `renderProductJsonLd`, new `{{CAMERA_JSONLD}}` template placeholder). Each camera emits name, image, listing URL, used-condition, InStock/SoldOut, and price (PLN) when known; `<` is escaped so a title can't break out of the `<script>`. Validated: 17 products parse cleanly.
- Added a **web manifest** (`site.webmanifest`) + `theme-color` meta and `rel="manifest"` link; added `site.webmanifest` to both workflows' `dist/` copy lists. (Apple-touch-icon still needs a square PNG — see open items.)

**Session 6 — 2026-08-06: guides, ads, and the CI backlog**
- **Per-camera-type guide pages** (the "highest-leverage traffic item" flagged below as not started): five Polish buyer guides under `poradniki/`, data in `scripts/guides.json`, shell in `templates/guide.template.html`. Each lists the cameras of its type live that day, cross-links its siblings, and carries `Article` JSON-LD. Homepage type headings link out to them.
- **Google AdSense wired but disabled** behind `scripts/ads-config.json` (four slots incl. one per guide page), plus a generated `polityka-prywatnosci.html`, `ads.txt`, and `Mediapartners-Google` in robots. See `ADSENSE.md`; the consent banner is Google's dashboard-side CMP, deliberately not hand-rolled.
- **Closed the remaining CI backlog**: URL/fetch validation with GitHub annotations (+ `--strict`), ESLint via `npx` (Prettier declined — see TODO for why), Lighthouse CI on PRs.
- **UX backlog**: per-camera notes (`scripts/camera-notes.json`), `NOWE` new-arrival chip (`firstSeen` in `olx_meta.json`), pixelate-on-hover easter egg.
- **Fixed a stray inconsistency:** `404.html` was still loading Cormorant/Inter/Press Start 2P from `fonts.googleapis.com` while every other page uses the self-hosted set — a third-party render-blocking request, and one more thing to disclose now that the site has a privacy policy. It now links `fonts/fonts.css` like the rest.
- **Conditional-request caching** added for OLX fetches; verified inert because OLX sends no `ETag`/`Last-Modified` (details in TODO).

---

## Bug check findings

### High priority

1. ~~**`404.html` "back" link goes to the wrong site.**~~ ✅ **Fixed 2026-06-13.** The button linked to `href="/"`, which on a GitHub Pages *project* site resolves to `https://110kc3.github.io/` — not the catalog. It now points at `https://stareaparaty.com/` (updated again during the custom-domain migration; the interim value was `/stare-aparaty/`).

2. ~~**Internal docs are published to the public site.**~~ ✅ **Fixed 2026-06-13.** Both workflows uploaded the Pages artifact with `path: .`, so `GROWTH-PLAN.md` (revenue numbers, monetization strategy), `TODO.md`, `scripts/`, and `templates/` were all fetchable on the live site. Both workflows now assemble a `dist/` folder containing only the public files (`index.html`, `404.html`, `favicon.svg`, `og-image.png`, `robots.txt`, `sitemap.xml`, `site.webmanifest`) and upload that. This also stops deploying the legacy `vintage_cameras.html` (finding #5).

3. **Domain mismatch: email vs. site.** ✅ **Code side done 2026-06-13** — canonical, OG/Twitter URLs, sitemap, robots, and the 404 home link now point to `https://stareaparaty.com/` (owner confirmed). ⚠️ **Remaining manual steps (repo settings + DNS, can't be done from the repo):**
   1. At the DNS provider: apex `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; plus `CNAME` record `www` → `110kc3.github.io`.
   2. GitHub repo **Settings → Pages → Custom domain**: enter `stareaparaty.com`, wait for the DNS check, then tick **Enforce HTTPS** (certificate provisioning can take up to ~1 h).
   3. After it's live, the old `110kc3.github.io/stare-aparaty/` URL redirects automatically. Re-submit the new sitemap URL in Search Console under a property for `stareaparaty.com`.

### Medium priority

4. ~~**`decodeHtmlEntities()` decodes in the wrong order.**~~ ✅ **Fixed 2026-06-13.** `&amp;` was replaced first, so a double-encoded entity (e.g. `&amp;lt;`) decoded twice into a raw `<`. Reordered so `&amp;` is decoded **last**.

5. **Legacy `vintage_cameras.html` is still tracked.** ✅ **Deploy side fixed 2026-06-13** — the `dist/`-only artifact (finding #2) no longer publishes it, so it's not publicly reachable or crawlable. It remains in the repo for reference; delete it if you want it gone entirely.

6. ~~**GoatCounter code mismatch.**~~ ✅ **Fixed 2026-06-13.** GROWTH-PLAN.md told you to register the code `stare-aparaty`, but the template loads `https://kc-it.goatcounter.com/count`. Aligned the docs to the deployed reality: GROWTH-PLAN now references the live `kc-it` account. **Superseded 2026-07-02:** GoatCounter removed entirely; analytics is now Cloudflare Web Analytics (RUM), auto-injected from the Cloudflare dashboard.

7. ~~**README is stale in several places.**~~ ✅ **Fixed 2026-06-13.** Corrected the `styles.css`/`retro.css` rows (now flagged as legacy-only, since `index.html` styles are inline in the template), fixed the `refresh-amazon.yml` → `.yml.disabled` name, completed the template-placeholder list (`{{PRICE_*}}`/`{{IMAGE_*}}`/`{{LAST_REFRESHED}}`), documented the `dist/`-only deploy and the `stareaparaty.com` custom domain, and added the missing public files to the structure table.

### Low priority / by design (verified OK, documenting the edge)

8. ~~**`discover-listings.js` regex depends on OLX's exact JSON key order**~~ ✅ **Hardened 2026-06-14.** The strict order-dependent regex is still tried first, but `extractOffers` now falls back to an order-independent parser (`extractOffersLoose`: anchor on each offer URL, attach the nearest title/status/owner) when the strict pass returns 0 — so a key reorder degrades gracefully instead of producing a red daily run.
9. ~~**HTTP 404 from OLX marks a listing as sold**~~ ✅ **Fixed 2026-06-14.** Only a definitive **410 Gone** now marks a card SPRZEDANE; a 404 falls through to the transient-error path, which preserves the previously-known sold state instead of stamping SPRZEDANE on a CDN hiccup.
10. ~~**`formatPrice()` drops prices with thousands separators in string form**~~ ✅ **Fixed 2026-06-13.** (`"1 234,56"` → NaN → no chip). Now strips whitespace (incl. NBSP/thin space) before parsing. Was unreachable with today's OLX data; hardened defensively.
11. ~~**Line endings**: git warns LF→CRLF on generated files.~~ ✅ **Fixed 2026-06-13.** Added `.gitattributes` with `* text=auto eol=lf` (and `*.png binary`).
12. ~~**No `:focus-visible` styles** in the template~~ ✅ **Fixed 2026-06-13.** Keyboard users got no focus indication (hover-only outline). Added `:focus-visible` rings for links, buttons, and both card types. Also added a `prefers-reduced-motion` block (separate TODO/UX item).

### Verified clean

- All 11 `{{PRICE_*}}`/`{{IMAGE_*}}` placeholders have matching entries in `scripts/amazon-products.json`; the generated `index.html` contains **zero leftover placeholders**.
- Escaping is consistent (`escapeHtml`/`escapeAttribute` on every interpolation into HTML).
- Workflow design is sound: single job discovers→builds→commits→deploys, shared `github-pages` concurrency group prevents double-deploys, bot pushes can't re-trigger workflows.
- Sold-state fallback logic preserves prior `sold: true` on transient fetch errors — correct.
- `refresh-amazon.js` (disabled): failure policy and retry pass are correct; no code bugs found — the blocker remains Amazon's captcha, as documented in TODO.

---

## Future steps verification (TODO.md / GROWTH-PLAN.md audit)

### Done but still unchecked in TODO.md — check these off

| TODO item | Evidence |
|---|---|
| Specific ASINs for accessories | All product cards link to `/dp/{ASIN}`; the search-page section no longer exists |
| Track affiliate click-through | ~~GoatCounter outbound events~~ (removed 2026-07-02; Cloudflare Web Analytics now, no custom events) |
| Show listing price on camera cards | JSON-LD price extraction + price chip implemented |
| OG + Twitter card meta | Full set in template `<head>` incl. branded `og-image.png` |
| Favicon | `favicon.svg` linked (apple-touch-icon + manifest still missing) |
| robots.txt + sitemap.xml | Both present and consistent |
| `loading="lazy"` on images | Template cards + card renderer (first row eager by design) |

Also stale: the **prefers-reduced-motion** item references the `.retro` hover styles, which only exist on the legacy page — rewrite or drop it.

### Done since the audit (2026-06-13)

- `:focus-visible` keyboard focus styles ✅
- `prefers-reduced-motion` support ✅
- `decodeHtmlEntities` ordering (#4), `formatPrice` hardening (#10), `.gitattributes` for line endings (#11) ✅
- **Product/Offer JSON-LD** structured data for the camera catalog ✅
- **Web manifest** (`site.webmanifest`) + `theme-color` ✅ (apple-touch-icon PNG still open)

### Genuinely open (validated as still-relevant)

> ⚠️ **This section is superseded by Session 6 (2026-08-06).** Everything listed
> below as open under "small / self-contained" and "larger" is now done, except
> where noted inline. The two "blocked on external approval" items still stand.

**Small / self-contained (no external dependency):**
- ~~**Apple-touch-icon (PNG).**~~ ✅ **Done 2026-06-14.** `scripts/generate-icons.js` rasterizes the pixel-art favicon into `apple-touch-icon.png` (180×180, linked in `<head>`) plus `icon-192/512.png` (added to the manifest); all three ship in both workflows' `dist/`.
- ~~**Group cameras by type** (SLR / rangefinder / compact / instant)~~ ✅ **Done 2026-06-14.** Title-based classification (`scripts/camera-types.json`) renders a labelled sub-section per non-empty type; flat grid when only one type.
- ~~**Validate discovered URLs in the workflow**~~ ✅ **Done 2026-08-06** (fetch-status tracking + GitHub annotations + `--strict`). ~~**ESLint**~~ ✅ **Done 2026-08-06** (Prettier declined on purpose). ~~**Lighthouse CI** on PRs~~ ✅ **Done 2026-08-06**. **Cache OLX fetches** — implemented as conditional requests, but inert: OLX sends no `ETag`/`Last-Modified`. See TODO for why the originally-proposed `actions/cache` approach was the wrong shape.

**Reliability hardening (done 2026-06-14):**
- Fetch timeout + retry in both scrapers; bounded-concurrency listing fetches; 410-only sold detection; order-independent OLX offer fallback parser; `assertRenderedOutput` build guard; `node:test` suite + `ci.yml`.

**Larger / needs design or content work:**
- ~~**Self-host fonts**~~ ✅ **Done 2026-06-14.** `scripts/fetch-fonts.js` → `fonts/` (woff2, latin + latin-ext) + `fonts/fonts.css`; template drops the Google Fonts request.
- ~~**Lightbox for camera photos.**~~ ✅ **Done 2026-06-14.** Magnifier button (sibling of the OLX link) opens an accessible lightbox; card still links to OLX.
- ~~**Per-camera guide pages** — GROWTH-PLAN's highest-leverage traffic item; none exist yet.~~ ✅ **First pass done 2026-08-06.** Five per-*type* guides under `poradniki/`. Per-*model* guides (higher buyer intent) are the follow-up — see GROWTH-PLAN §2.

**Blocked on external approval:**
- **PA-API price refresh** — needs Amazon Associates approval (see deadline below); the Playwright scraper stays disabled until then.
- **Allegro Affiliate** second button on film cards — needs an approved Allegro Affiliate account.

### GROWTH-PLAN action items — current state

1. **Analytics** — GoatCounter removed 2026-07-02; Cloudflare Web Analytics (RUM) enabled instead, auto-injected via the Cloudflare dashboard.
2. **Google Search Console + sitemap submission** — not verifiable from the repo; sitemap is ready (and now points at `stareaparaty.com`). Do this once the custom domain is live, before writing guide pages.
3. ~~**First per-camera guide page** — not started.~~ ✅ **Done 2026-08-06** — five per-type guides shipped; per-model guides are next.
4. **Allegro Affiliate application** — not verifiable from the repo; no Allegro links present yet.
5. **⏰ Amazon Associates deadline** — the plan (dated June 2026) warns the account closes with <3 qualifying sales in 180 days, killing the PA-API path. If nothing has sold by **autumn 2026**, expect to re-apply.

### Manual steps still pending on your side (cannot be done from the repo)

1. **Custom domain DNS + Pages setting** for `stareaparaty.com` (finding #3): apex `A` records → `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`; `CNAME` `www` → `110kc3.github.io`; then **Settings → Pages → Custom domain** + **Enforce HTTPS**.
   - ✅ **`CNAME` file: shipped.** The repo-root `CNAME` (`stareaparaty.com`) is in the `cp … dist/` line of both workflows, so `actions/deploy-pages` can no longer clear the Settings-level custom domain.
2. **Google Search Console** property + sitemap submission. The sitemap now carries the five guide pages and the privacy policy, so submit it again after this deploy.
3. **AdSense**: account, publisher id, ad units, and the GDPR consent message — all dashboard-side. Runbook in `ADSENSE.md`. Also fill in the data-controller identity in `templates/privacy.template.html` §1 (RODO art. 13 wants more than "właściciel serwisu").

### Recommended order of attack

1. ~~Fix the 404 link and the artifact `path: .` exposure.~~ ✅ Done 2026-06-13.
2. ~~Decide the domain question (#3).~~ ✅ Code migrated to `stareaparaty.com`; only DNS + Pages settings remain (manual, above).
3. ~~Resolve the GoatCounter mismatch.~~ ✅ Moot — GoatCounter removed 2026-07-02 in favour of Cloudflare Web Analytics.
4. ~~Finish the DNS/Pages cutover, then write the first camera guide page.~~ ✅ Guides done 2026-08-06; the DNS/Pages cutover is the last manual piece.
5. ~~Optional code follow-ups: Product JSON-LD, font self-hosting, CI niceties.~~ ✅ All done (Prettier declined deliberately — see TODO).
6. **What's left is almost entirely off-repo:** DNS + Pages settings, Search Console, AdSense onboarding, Allegro Affiliate, Amazon PA-API keys. The one substantial code item still open is **per-model guide pages** — let Search Console indicate which type guide draws impressions first.
