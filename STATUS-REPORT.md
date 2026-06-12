# Status Report — Bug Check & Future Steps Audit

*Generated 2026-06-13. Covers: full review of scripts, workflows, templates, generated output, and planning docs (TODO.md, GROWTH-PLAN.md).*

> Note: bug #2 below (whole repo published as the Pages artifact) is fixed — internal docs like this file no longer ship to the live site.

## What changed today

- Added contact email **support@stareaparaty.com** to the page: a `Kontakt` link in the masthead nav and a `mailto:` line in the footer (`templates/index.template.html`), plus footer link styling. `index.html` regenerated via `node scripts/build-catalog.js` (17 listings, all metadata unchanged).

---

## Bug check findings

### High priority

1. ~~**`404.html` "back" link goes to the wrong site.**~~ ✅ **Fixed 2026-06-13.** The button linked to `href="/"`, which on a GitHub Pages *project* site resolves to `https://110kc3.github.io/` — not the catalog. Now links to `/stare-aparaty/`.

2. ~~**Internal docs are published to the public site.**~~ ✅ **Fixed 2026-06-13.** Both workflows uploaded the Pages artifact with `path: .`, so `GROWTH-PLAN.md` (revenue numbers, monetization strategy), `TODO.md`, `scripts/`, and `templates/` were all fetchable on the live site. Both workflows now assemble a `dist/` folder containing only the public files (`index.html`, `404.html`, `favicon.svg`, `og-image.png`, `robots.txt`, `sitemap.xml`) and upload that. This also stops deploying the legacy `vintage_cameras.html` (finding #5).

3. **Domain mismatch: email vs. site.** ✅ **Code side done 2026-06-13** — canonical, OG/Twitter URLs, sitemap, robots, and the 404 home link now point to `https://stareaparaty.com/` (owner confirmed). ⚠️ **Remaining manual steps (repo settings + DNS, can't be done from the repo):**
   1. At the DNS provider: apex `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; plus `CNAME` record `www` → `110kc3.github.io`.
   2. GitHub repo **Settings → Pages → Custom domain**: enter `stareaparaty.com`, wait for the DNS check, then tick **Enforce HTTPS** (certificate provisioning can take up to ~1 h).
   3. After it's live, the old `110kc3.github.io/stare-aparaty/` URL redirects automatically. Re-submit the new sitemap URL in Search Console under a property for `stareaparaty.com`.

### Medium priority

4. **`decodeHtmlEntities()` decodes in the wrong order** (`scripts/build-catalog.js:437`). `&amp;` is replaced first, so a listing title containing a double-encoded entity (e.g. `&amp;lt;`) decodes twice into a raw `<`. The decoded string is later re-escaped before rendering, so there is no injection risk — titles just display wrong. Fix: decode `&amp;` **last**.

5. **Legacy `vintage_cameras.html` is still tracked and deployed.** It's the old hand-made page (uses `retro.css`/`styles.css`) with stale listings and affiliate links, publicly reachable and crawlable. Delete it, or keep it only locally.

6. **GoatCounter code mismatch.** GROWTH-PLAN.md says to register the code `stare-aparaty` and warns it "must match the script URL in the template", but the template loads `https://kc-it.goatcounter.com/count`. If the active account is `kc-it`, update the plan; if it's `stare-aparaty`, the site is currently sending events into the void. Verify which dashboard actually shows traffic.

7. **README is stale in several places.** The project-structure table claims `styles.css` is "Main layout and visual styles" and lists `retro.css` — but `index.html` styles are inline in the template; those CSS files are used only by the legacy page. The table also lists `refresh-amazon.yml` while the real file is `refresh-amazon.yml.disabled`, and the template-placeholder list misses `{{PRICE_*}}`/`{{IMAGE_*}}`/`{{LAST_REFRESHED}}`.

### Low priority / by design (verified OK, documenting the edge)

8. **`discover-listings.js` regex depends on OLX's exact JSON key order** (`"title"…"status"…"url"…"user":{"id"`). If OLX reorders fields, discovery finds 0 offers and the workflow fails loudly while leaving `product-links.txt` untouched — safe failure mode, but expect an occasional red daily run.
9. **HTTP 404 from OLX marks a listing as sold** (`build-catalog.js:125`). Deliberate, but a transient 404 (CDN hiccup) would stamp SPRZEDANE until the next successful daily run self-heals it.
10. **`formatPrice()` drops prices with thousands separators in string form** (`"1 234,56"` → NaN → no chip). OLX JSON-LD emits plain numbers today, so currently unreachable.
11. **Line endings**: git warns LF→CRLF on generated files. A small `.gitattributes` (`*.html text eol=lf` etc.) would silence this on Windows.
12. **No `:focus-visible` styles** in the template — keyboard users get no focus indication on camera cards (hover-only outline). Small a11y win, already implied by a TODO item.

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
| Track affiliate click-through | GoatCounter + outbound `out-olx-*` / `out-amazon-*` events live in the template |
| Show listing price on camera cards | JSON-LD price extraction + price chip implemented |
| OG + Twitter card meta | Full set in template `<head>` incl. branded `og-image.png` |
| Favicon | `favicon.svg` linked (apple-touch-icon + manifest still missing) |
| robots.txt + sitemap.xml | Both present and consistent |
| `loading="lazy"` on images | Template cards + card renderer (first row eager by design) |

Also stale: the **prefers-reduced-motion** item references the `.retro` hover styles, which only exist on the legacy page — rewrite or drop it.

### Genuinely open (validated as still-relevant)

- Apple-touch-icon + web manifest
- Product JSON-LD structured data
- Self-host fonts (Google Fonts is still a render-blocking third-party request)
- Lightbox for camera photos; `:focus-visible` styles; group cameras by type
- PA-API price refresh (blocked on Amazon Associates approval — see deadline below)
- Validate discovered URLs in workflow; cache OLX fetches; ESLint/Prettier; Lighthouse CI
- Per-camera guide pages (GROWTH-PLAN's highest-leverage traffic item — none exist yet)

### GROWTH-PLAN action items — current state

1. **GoatCounter registration** — ⚠️ unverifiable from the repo, and the code mismatch (#6 above) must be resolved first.
2. **Google Search Console + sitemap submission** — not verifiable from the repo; sitemap is ready. Do this before writing guide pages so indexing data exists.
3. **First per-camera guide page** — not started. Still the single highest-leverage item.
4. **Allegro Affiliate application** — not verifiable from the repo; no Allegro links present yet.
5. **⏰ Amazon Associates deadline** — the plan (dated June 2026) warns the account closes with <3 qualifying sales in 180 days, killing the PA-API path. If nothing has sold by **autumn 2026**, expect to re-apply.

### Recommended order of attack

1. ~~Fix the 404 link and the artifact `path: .` exposure.~~ ✅ Done 2026-06-13.
2. Decide the domain question (#3) — it affects canonical/OG/sitemap and every future SEO step.
3. Resolve the GoatCounter mismatch so measurement is trustworthy.
4. Check off completed TODO items and write the first camera guide page.
