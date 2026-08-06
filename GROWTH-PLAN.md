# Growth & Monetization Plan

*June 2026. Based on: ~56 affiliate clicks / 30 days, 0 Amazon sales, zł0 earnings.*

## Reality check

At this traffic level the affiliate program cannot work — the problem is visitors, not conversion. Even a 3% conversion on 56 clicks rounds to zero. Meanwhile each camera sale is worth 40–520 zł. **Priority order: (1) sell cameras, (2) grow traffic, (3) only then optimize affiliate revenue.**

⚠️ **Amazon deadline:** Associates accounts with fewer than 3 qualifying sales in 180 days get closed, which also kills the PA-API plan in TODO.md. If no sales land by autumn, expect to re-apply later — not a catastrophe, but plan for it.

## 1. Sell the cameras (the real money)

- Prices now render on every card (done — pulled from OLX JSON-LD).
- **Bundle a starter kit** in each OLX description: camera + link to this site for film recommendations. Buyers of a first analog camera don't know what film to buy — that's your affiliate hook with actual intent.
- **Sample photos sell cameras.** One scanned roll per camera (or even per lens family) posted in the OLX ad measurably outperforms spec lists for first-time buyers.
- **Cross-list** the same cameras on Allegro Lokalnie and Vinted (electronics allowed) and Facebook Marketplace — zero extra inventory work, the build already tracks sold state via OLX 410s.

## 2. Traffic (the prerequisite for everything else)

- **Per-camera-type guide pages — first pass shipped.** Five guides live under `poradniki/` (lustrzanki SLR, kompaktowe, dalmierzowe, zestawy, obiektywy), written in `scripts/guides.json` and rendered by the build. Each one ends with the cameras of that type currently in the catalog and links through to the film sections, so a guide reader lands one click from an OLX listing. Every type heading on the homepage links to its guide, and all five are in the sitemap and `llms.txt`.
- **Next: per-model guides.** "Pentax ME — recenzja i jaki film wybrać", "Zenit B + Helios 44-2 — instrukcja dla początkujących". Type-level guides cover the generic queries; model-level ones catch the buyer already searching a specific body, which is where the intent is highest. Same pipeline — add an entry to `guides.json`. Watch Search Console for which type guide picks up impressions first and write the model guides underneath it.
- **Google Search Console**: submit `sitemap.xml` (added), verify the property. Free and takes 10 minutes.
- **Polish analog community**: Facebook groups (Fotografia Analogowa, Aparaty Analogowe — sprzedam/kupię), wykop.pl, r/analog. Don't spam links — answer beginner questions ("jaki aparat na start do 300 zł?") and reference your guides.
- **Social previews now work** (OG tags + branded og-image.png added) — sharing the site in those groups no longer shows a blank card.

## 3. Affiliate: fix the mismatch

Amazon.pl is a weak place to send Polish film buyers — selection and prices for film are mediocre vs Allegro. Options researched June 2026:

| Program | Commission | Notes |
|---|---|---|
| **Allegro Affiliate Business** | 0.2–2.42% CPS | Official program; where Poles actually buy film. Also reachable via MyLead. Allegro Share (points/coupons) is the consumer variant — skip it. |
| **Cyfrowe.pl** (TradeTracker) | 1.3% general / **4% accessories** | Largest PL photo store; carries film, chemistry, accessories. 4% on accessories beats Amazon's typical rate. |
| **webePartners network** | 3–4% typical | Polish e-commerce affiliate network; check which photo shops are currently listed. |
| Fotoforma | cashback only (Fonia) | No classic affiliate program — not useful here. |

Suggested move: keep Amazon links for now (sunk setup, some users prefer it), add an Allegro link as a second button on each film card once the Allegro Affiliate account is approved.

## 3b. Display ads (wired, not switched on)

AdSense is fully wired but ships disabled behind `scripts/ads-config.json` — see `ADSENSE.md` for the activation runbook. Three placements: mid-page, one card-shaped unit completing the colour-film row, one above the footer.

Set expectations honestly before flipping it on:

- **At current traffic this earns roughly nothing.** Display RPM in the Polish market is single-digit złoty per thousand pageviews; the traffic work in §2 is still the only thing that changes the picture. Ads are worth switching on now mainly so the account exists and is seasoned by the time traffic arrives.
- **Approval is genuinely uncertain.** One page of affiliate cards is what AdSense calls thin content. A rejection is a signal to write the guide pages, not to resubmit.
- **It costs something.** Turning ads on ends the site's consent-banner-free status (a Google-certified CMP becomes mandatory for EU traffic) and puts third-party units next to your own affiliate cards, which compete for the same click. If a camera sale is worth 40–520 zł and a display click is worth ~0.10 zł, keep the ads out of the camera catalog — which is why there is no slot in the `#aparaty` section.

## 4. Measure (unblocked today)

Analytics = **Cloudflare Web Analytics (RUM)**, auto-injected via the Cloudflare dashboard (no snippet in the repo). Cookieless, no consent banner needed. Note: no custom events — the former GoatCounter per-link outbound click tracking was removed 2026-07-02.

## What changed in this session

- OG/Twitter meta, canonical URL, branded `og-image.png`, `favicon.svg` (template + new files)
- `robots.txt` + `sitemap.xml`
- OLX price extraction in `build-catalog.js` → price chip on camera cards, cached in `olx_meta.json`
- `loading="lazy"` on below-the-fold images (template + card renderer)

## Your action items

1. Add the site to Google Search Console, submit the sitemap.
2. Pick one camera and write the first guide page — validate the traffic thesis before scaling.
3. Apply to Allegro Affiliate Business.
