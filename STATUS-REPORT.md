# Status Report — Bug Check & Future Steps Audit

*Generated 2026-06-13. Covers: full review of scripts, workflows, templates, generated output, and planning docs (TODO.md, GROWTH-PLAN.md).*
*Last refreshed 2026-08-11 — see "Session 8" below.*

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
- **Guide pages** (the "highest-leverage traffic item" flagged below as not started): **seven** Polish buyer guides under `poradniki/` — five per camera type plus two per model (Pentax ME, Zenit B + Helios 44-2, the two GROWTH-PLAN named). Data in `scripts/guides.json`, shell in `templates/guide.template.html`. Each lists the cameras it matches live that day, cross-links its siblings, and carries `Article` JSON-LD. Homepage type headings link to the type guides; model guides are reached from the cross-link row.
- **Google AdSense wired but disabled** behind `scripts/ads-config.json` (four slots incl. one per guide page), plus a generated `polityka-prywatnosci.html`, `ads.txt`, and `Mediapartners-Google` in robots. See `ADSENSE.md`; the consent banner is Google's dashboard-side CMP, deliberately not hand-rolled.
- **Closed the remaining CI backlog**: URL/fetch validation with GitHub annotations (+ `--strict`), ESLint via `npx` (Prettier declined — see TODO for why), Lighthouse CI on PRs.
- **UX backlog**: per-camera notes (`scripts/camera-notes.json`), `NOWE` new-arrival chip (`firstSeen` in `olx_meta.json`), pixelate-on-hover easter egg.
- **Fixed a stray inconsistency:** `404.html` was still loading Cormorant/Inter/Press Start 2P from `fonts.googleapis.com` while every other page uses the self-hosted set — a third-party render-blocking request, and one more thing to disclose now that the site has a privacy policy. It now links `fonts/fonts.css` like the rest.
- **Conditional-request caching** added for OLX fetches; verified inert because OLX sends no `ETag`/`Last-Modified` (details in TODO).

**Session 7 — 2026-08-07: the last three model guides, and a repo that is now genuinely account-blocked**
- **Three per-model guides** — `praktica-bca`, `yashica-35w`, `canon-eos` — closing the one substantial code item Session 6 left open. Ten guides total (5 type + 5 model). Each leads with the single fact that changes a purchase decision: the PB-vs-M42 mount split on the Praktica, the discontinued 1.35 V PX625 mercury cell on the Yashica, and EF-vs-EF-S mount compatibility on the EOS.
- **This validated the model-guide design more strongly than expected.** The two Praktica listings classify into *different* catalog sections (`Zestawy` and `Lustrzanki (SLR)`), and the Canon EOS listing into `Zestawy`. Keyword matching gathers them; a type guide structurally could not. Worth remembering before anyone proposes simplifying `kind: "model"` away.
- **Merge hygiene:** rebased onto 31 accumulated `chore: auto-discover camera catalog` bot commits. All source conflicts were *additive on both sides* (deploy workflows, `build-catalog.js`) and resolved as unions — see the note below on why that keeps recurring.
- ✅ **Fixed the catalog flap** found while rebasing: bot commit `80f0f6f` deleted 9 entries from `product-links.txt` and `a947b06` re-added the same 9, so the live site had been swinging between 10 and 19 cameras depending on whether OLX served that night's scrape in full. `discover-listings.js` now refuses to write a list that lost more than 30% of its entries in one run. Details as finding #13.
- **Two "blocked" TODO items were actually finished a month ago.** The Allegro Affiliate onboarding and the Amazon → Allegro card switch were both still filed as pending/blocked, but the repo says otherwise: 10 `allegro.pl/affiliate` deep links on a single joined campaign (`8902aaa9-…`), 10 × "Sprawdź na Allegro" against 5 × "Sprawdź na Amazon", the footer disclaimer already naming both marketplaces, and a populated `scripts/allegro-products.json`. All ten are retail `/produkt/` or `/oferta/` listings, so none fall into the auction / "Kolekcja i Sztuka" categories Allegro pays no commission on. Marked done across TODO, GROWTH-PLAN and this file. **Lesson for future audits: check the template before trusting the backlog** — this repo's planning docs drift behind the code, which is the failure mode this report exists to catch.
- **Privacy policy §1 settled.** The data-controller identity had been an open RODO art. 13 gap since the policy shipped. Resolved with the owner: the site is run by a **private individual, not a registered business**, so §1 names a natural person with `support@stareaparaty.com` as the contact channel and deliberately carries no company name or NIP. Recorded in three places so nobody "fixes" it by inventing details — the template, the `PRIVACY_UPDATED` comment in `build-catalog.js`, and TODO. `PRIVACY_UPDATED` bumped to 7 sierpnia 2026 since the policy text genuinely changed.
- **PA-API deferred by decision, not blocked.** Declined to build the Amazon PA-API refresh speculatively: it cannot be tested without keys (SigV4 signing fails silently when wrong), the Associates account may close under the <3-sales/180-days rule, and Allegro now carries 10 of 15 product cards, so Amazon price staleness affects a third of the catalog rather than all of it. The spec in TODO stays accurate for whenever keys exist.
- **What is genuinely left needs an account, not code.** AdSense (dashboard) and Search Console — the latter now the critical path for further guide work, since the named guide candidates are exhausted and choosing a sixth without impression data would be guessing.

**Session 8 — 2026-08-11: the sitemap was lying, and the git log proved it**
- ✅ **Fixed a false `<lastmod>` on 11 of 12 sitemap URLs** — finding #14 below. `renderSitemap` stamped the build date on the homepage and all ten guides, every night. This is precisely the pattern Google's sitemap documentation names as the reason it discards `lastmod` values, so the site was burning a crawl-priority signal to communicate nothing. Now each generated page is content-fingerprinted into `scripts/page-state.json` and `<lastmod>` reports the date the fingerprint last moved.
- **The homepage needed special handling, and it is the part worth remembering.** Its only nightly diff was its own masthead build stamp (`Aktualizacja: 11 sie 2026, 08:12`) — hashing the page as-is would have produced a fingerprint that changes every night for content that didn't, reproducing the bug at the single most important URL. That span's text is stripped before hashing, and a test asserts the strip still matches the rendered markup, so renaming the class in the template fails CI instead of silently re-breaking the sitemap.
- **Seeded from git history rather than stamped today.** `git log -1 --format=%cs` per generated file gave each page its real last-changed date, so the first deploy after this change was already honest: `kompaktowe.html` at 2026-08-09, the other nine guides and the privacy policy at 2026-08-07. Stamping everything with today's date would have worked too, but would have opened with one more day of the same false signal this change exists to remove.
- **The privacy policy gained an honest `<lastmod>`.** It previously had none — deliberately, and correctly, because the only date available was the build date. With fingerprinting there is a real one to give.
- **Workflow fix found on the way:** the commit step tested `git diff --quiet` *before* staging. `git diff` doesn't see untracked files, so on the first run after adding `scripts/page-state.json` the new file would have read as "no changes to commit" and never been committed — leaving every subsequent run with nothing to compare against and silently restoring the old behaviour. The step now stages first and tests `git diff --cached`.
- Verified end-to-end rather than by unit test alone: backdated the whole state file to 2026-07-01 and rebuilt — all twelve URLs kept the July date; then corrupted one page's stored fingerprint and rebuilt — only that URL advanced to today. 78 tests pass, ESLint clean.
- ✅ **Closed a blind spot in the test suite: links between generated pages** (`test/links.test.js`, 4 tests, suite now 82). Audited the live output first — all 202 internal links across the 13 public pages resolve today, so this is a guard, not a repair. The exposure it covers is structural: every existing build guard checks a page against itself, while `guide.template.html` hard-codes three anchors (`../#filmy-bw`, `../#filmy-kolor`, `../#wywolywanie`) whose ids live in `index.template.html`. Renaming one of those homepage ids breaks the same link on all ten guides, and the build would have shipped it green. The suite also pins each guide's canonical URL to the path it was written to, and every sitemap `<loc>` to a file that ships.
- ✅ **The site was telling visitors it served ads it does not serve** — finding #15 below, and the most substantive of the three. `enabled: false` suppressed all ad *markup*, but every sentence *describing* the ads shipped unconditionally: privacy policy §3 ("Serwis wyświetla reklamy za pośrednictwem Google AdSense", plus a promised consent message no visitor has ever seen), the §2 advertising-data bullet, consent as a §5 legal basis under art. 6(1)(a) RODO, §8's claim that blocking cookies affects ad targeting on a site that sets none, the homepage footer, and `llms.txt`. All six now switch on `ads-config.json`. The ads-ON text is the reviewed wording kept verbatim — proven by diffing an ads-on render against the published policy, where the only differences are the loader script, the consent button and the date.
- **Why this was worth treating as a defect and not tidying.** The over-claiming direction is the less dangerous one legally, but the policy is the page a reader opens specifically to find out what the site does to them, and it contradicted the site's one genuine advantage on that front — cookieless analytics, no consent banner, which GROWTH-PLAN §4 and the README both state as deliberate. `PRIVACY_UPDATED` is bumped to 11 sierpnia 2026, and because flipping the ads flag now changes the published policy text, `ADSENSE.md` carries that bump as a step.
- ✅ **`llms.txt` is generated now** (`templates/llms.template.txt`), closing two drifts in a file that ships publicly and is read by agents: the same false ads claim, and ten hand-copied guide lines that needed a second edit whenever a guide changed. Guide lines come from a new `llms` field in `guides.json`, enforced by a test rather than by the build — a missing English blurb is a docs omission and shouldn't be able to stop the nightly deploy. Regeneration was lossless (byte-identical apart from the intended edits). Also fixed the agent-card line, which pointed only at the pre-0.3 `/.well-known/agent.json` while the deploy serves the A2A 1.0 `agent-card.json` a current client actually requests.
- ✅ **`llms-full.txt` was generated on every run and committed on none of them** — it was missing from the workflow's `git add` list, so the deployed file moved nightly while the repo copy stayed frozen. Both llms files are in the list now.
- ⚠️ **Stale instruction removed from `ADSENSE.md`.** Its "Before the first live impression" section still told the reader to put a business name, address and NIP into privacy policy §1 and quoted wording the page hasn't used since 2026-08-07 — i.e. it instructed precisely the invention of business details that TODO, the template comment and the `PRIVACY_UPDATED` comment all warn against. This is the doc-drift failure mode Session 7 flagged, caught one file later.
- ⚠️ **The live footer was promising prices "sprawdzone 2026-06-22"** while sixteen of the seventeen entries were checked 2026-07-06 — finding #16. A single Amazon entry (`B0000AE6AX`, Ilford HP5 Plus) had held the published date two weeks behind the rest for over a month. The oldest-wins rule is correct and stays; what was missing was any way to *notice*. `PLAN-2026-07-03.md` had found it by hand on 3 July and it was still live on 11 August, which is the case for automating the noticing rather than the fixing. The build now warns, naming the exact entry that sets the date and the date refreshing it would produce. **The underlying data is still stale — that part needs a human with a browser**, since the scraper is captcha-blocked and PA-API is deferred. All 17 prices are ≥36 days old.
- **The guards were validated by breaking the site on purpose.** Renaming `id="wywolywanie"` in `index.html` produced eleven named failures (homepage nav + ten guides); an invented href was reported as a missing file; a typo'd sitemap `loc` and a mismatched canonical each failed their own test; the tree was then restored and all 82 pass. A test that has never been seen to fail is not evidence of anything, which is why this is recorded here.

---

## Bug check findings

### High priority

1. ~~**`404.html` "back" link goes to the wrong site.**~~ ✅ **Fixed 2026-06-13.** The button linked to `href="/"`, which on a GitHub Pages *project* site resolves to `https://110kc3.github.io/` — not the catalog. It now points at `https://stareaparaty.com/` (updated again during the custom-domain migration; the interim value was `/stare-aparaty/`).

2. ~~**Internal docs are published to the public site.**~~ ✅ **Fixed 2026-06-13.** Both workflows uploaded the Pages artifact with `path: .`, so `GROWTH-PLAN.md` (revenue numbers, monetization strategy), `TODO.md`, `scripts/`, and `templates/` were all fetchable on the live site. Both workflows now assemble a `dist/` folder containing only the public files (`index.html`, `404.html`, `favicon.svg`, `og-image.png`, `robots.txt`, `sitemap.xml`, `site.webmanifest`) and upload that. This also stops deploying the legacy `vintage_cameras.html` (finding #5).

3. **Domain mismatch: email vs. site.** ✅ **Code side done 2026-06-13** — canonical, OG/Twitter URLs, sitemap, robots, and the 404 home link now point to `https://stareaparaty.com/` (owner confirmed). ⚠️ **Remaining manual steps (repo settings + DNS, can't be done from the repo):**
   1. At the DNS provider: apex `A` records → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`; plus `CNAME` record `www` → `110kc3.github.io`.
   2. GitHub repo **Settings → Pages → Custom domain**: enter `stareaparaty.com`, wait for the DNS check, then tick **Enforce HTTPS** (certificate provisioning can take up to ~1 h).
   3. After it's live, the old `110kc3.github.io/stare-aparaty/` URL redirects automatically. Re-submit the new sitemap URL in Search Console under a property for `stareaparaty.com`.

13. ~~**A partial OLX scrape silently deleted half the catalog.**~~ ✅ **Fixed 2026-08-07.** `discover-listings.js` guarded only the all-or-nothing case (`kept.length === 0` → leave the file untouched). A *partial* scrape — OLX serving page 1 but blocking page 2 — passed that check and overwrote `product-links.txt` with a plausible-looking truncated list. Observed live: bot commit `80f0f6f` cut the file from 19 links to 10, and `a947b06` restored all 9 the next night, so the site published a half-empty catalog for a day with nothing in the logs flagging it. This is the worst class of bug for this project — the site exists to sell cameras and it quietly stopped showing half of them. Now `shrinkRefusal()` refuses to write when more than **30%** of the previous list disappears at once (floor: 5 links, so a small list or a first run is unaffected), exiting non-zero so the workflow stops *before* rebuilding and the live site keeps yesterday's complete catalog. `--allow-shrink` overrides it for a genuine bulk removal. Verified against the live scrape: 18 discovered vs 19 on file is a 5% drop and passes; the observed 19→10 case is refused. Five unit tests cover the thresholds.

### Medium priority

14. ~~**The sitemap claimed every page changed on every build.**~~ ✅ **Fixed 2026-08-11.** `renderSitemap` computed one `lastmod` — today — and emitted it for the homepage and all ten guide pages. The git log shows how false that was: commits `7ed1d3b` (08-08), `702428c` (08-10) and `11c23aa` (08-11) each changed `index.html` and `sitemap.xml` and **no guide file whatsoever**, while the sitemap told Google all ten guides were modified those nights. Google's sitemap documentation states it ignores `lastmod` when the value isn't credible, and an always-today date across every URL is the canonical example — so the element was costing bytes and buying nothing. The homepage was subtler and arguably worse: its only nightly diff was its own masthead build stamp, making its `lastmod` self-referential. Fix: fingerprint each generated page (SHA-256, masthead build stamp stripped first), store `{fingerprint, lastmod}` per URL in `scripts/page-state.json`, and emit the stored date. Unknown URL → no `lastmod` element, never an invented one. The initial state file was seeded from `git log` so the dates were honest on the first deploy. Four unit tests cover it, including one that fails if a template change stops the build-stamp strip from matching — otherwise this bug could quietly return. Related workflow fix: the commit step staged *after* testing `git diff`, which cannot see an untracked file, so the new state file would never have been committed; it now stages first and tests `git diff --cached`.

15. ~~**Ad disclosures shipped unconditionally while the ads themselves were config-gated.**~~ ✅ **Fixed 2026-08-11.** With `enabled: false` the site loads no Google script and sets no cookie, yet the published privacy policy stated that it serves AdSense, promised a consent message on first visit, listed "Dane reklamowe — zbierane przez Google" among the data collected, and named consent (art. 6 ust. 1 lit. a RODO) as a legal basis — all describing processing that does not occur. §8 told readers that blocking cookies would affect ad targeting on a site that sets no cookies. The homepage footer and the published `llms.txt` made the same claim. Root cause: `{{ADSENSE_HEAD}}`, the ad units, `{{CONSENT_REVOKE}}` and `ads.txt` were all gated on `scripts/ads-config.json`, but the prose was hard-coded into the templates, so only half the feature was switchable. Now `{{ADS_DATA_BULLET}}`, `{{ADS_SECTION}}`, `{{LEGAL_BASIS_ITEMS}}`, `{{COOKIE_BROWSER_NOTE}}` and `{{ADS_DISCLOSURE}}` render from the same flag; §3 keeps its heading in both states so §4–§9 cannot renumber. The ads-on wording is unchanged from what was reviewed — confirmed by diff, not by reading. `PRIVACY_UPDATED` → 11 sierpnia 2026, and `ADSENSE.md` now instructs the bump when the flag flips, since flipping it rewrites the published policy. Four tests cover both states.

16. **Price data is stale, and nothing said so.** ⚠️ **Half-fixed 2026-08-11 — the reporting is in, the data still needs you.** The footer's "sprawdzone" date is the oldest `lastChecked` across `amazon-products.json` + `allegro-products.json`, which is the honest rule but means one forgotten entry speaks for all seventeen cards. On 2026-08-11 the live site claimed **sprawdzone 2026-06-22** because `B0000AE6AX` (Ilford HP5 Plus) had never been refreshed with the others, and the remaining sixteen were themselves 36 days old. `build-catalog.js` now emits `::warning::` annotations: a collapsed staleness line (per-entry lines only when a *subset* is behind — otherwise seventeen identical warnings per night train the reader to ignore them), an explicit "this entry sets the footer date, refreshing it moves the date to X" line, and a separate warning for any entry with no `lastChecked`, which would otherwise escape the promise entirely. Warn-only by design: a stale price still renders a usable page, CI cannot fix it, and failing the build would block the camera catalog too. **What remains is manual** — open the seventeen product pages, update the prices and dates, rebuild. That is the interim procedure until PA-API keys exist (TODO), and it is now a visible chore rather than an invisible one.

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
- ~~**Allegro Affiliate** second button on film cards — needs an approved Allegro Affiliate account.~~ ✅ **Done, and superseded.** The account was approved and the catalog went further than a second button: cards moved individually to whichever marketplace is cheaper, now 10 Allegro to 5 Amazon.

### GROWTH-PLAN action items — current state

1. **Analytics** — GoatCounter removed 2026-07-02; Cloudflare Web Analytics (RUM) enabled instead, auto-injected via the Cloudflare dashboard.
2. **Google Search Console + sitemap submission** — not verifiable from the repo; sitemap is ready (and now points at `stareaparaty.com`). Do this once the custom domain is live, before writing guide pages.
3. ~~**First per-camera guide page** — not started.~~ ✅ **Done 2026-08-06** — five per-type guides shipped; per-model guides are next.
4. ~~**Allegro Affiliate application** — not verifiable from the repo; no Allegro links present yet.~~ ✅ **Done.** Now very much verifiable from the repo: 10 `allegro.pl/affiliate` deep links on campaign `8902aaa9-…`, priced from `scripts/allegro-products.json`.
5. **⏰ Amazon Associates deadline** — the plan (dated June 2026) warns the account closes with <3 qualifying sales in 180 days, killing the PA-API path. If nothing has sold by **autumn 2026**, expect to re-apply.

### Manual steps still pending on your side (cannot be done from the repo)

1. **Custom domain DNS + Pages setting** for `stareaparaty.com` (finding #3): apex `A` records → `185.199.108.153`, `.109.153`, `.110.153`, `.111.153`; `CNAME` `www` → `110kc3.github.io`; then **Settings → Pages → Custom domain** + **Enforce HTTPS**.
   - ✅ **`CNAME` file: shipped.** The repo-root `CNAME` (`stareaparaty.com`) is in the `cp … dist/` line of both workflows, so `actions/deploy-pages` can no longer clear the Settings-level custom domain.
2. **Google Search Console** property + sitemap submission. The sitemap carries all **ten** guide pages plus the privacy policy, and since 2026-08-11 its `lastmod` dates are per-page and truthful (finding #14) — worth submitting after this deploy, because a sitemap Google trusts is the point of the change.
3. **AdSense**: account, publisher id, ad units, and the GDPR consent message — all dashboard-side. Runbook in `ADSENSE.md`. Also fill in the data-controller identity in `templates/privacy.template.html` §1 (RODO art. 13 wants more than "właściciel serwisu").

### Recommended order of attack

1. ~~Fix the 404 link and the artifact `path: .` exposure.~~ ✅ Done 2026-06-13.
2. ~~Decide the domain question (#3).~~ ✅ Code migrated to `stareaparaty.com`; only DNS + Pages settings remain (manual, above).
3. ~~Resolve the GoatCounter mismatch.~~ ✅ Moot — GoatCounter removed 2026-07-02 in favour of Cloudflare Web Analytics.
4. ~~Finish the DNS/Pages cutover, then write the first camera guide page.~~ ✅ Guides done 2026-08-06; the DNS/Pages cutover is the last manual piece.
5. ~~Optional code follow-ups: Product JSON-LD, font self-hosting, CI niceties.~~ ✅ All done (Prettier declined deliberately — see TODO).
6. **What's left is almost entirely off-repo:** DNS + Pages settings, Search Console, AdSense onboarding, Allegro Affiliate, Amazon PA-API keys. The one substantial code item still open is **per-model guide pages** — let Search Console indicate which type guide draws impressions first.
