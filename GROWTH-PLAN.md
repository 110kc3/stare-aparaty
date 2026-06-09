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

- **Per-camera guide pages.** "Pentax ME — recenzja i jaki film wybrać", "Zenit B + Helios 44-2 — instrukcja dla początkujących". Polish-language analog content is thin; these are low-competition queries with buyer intent. Each guide links to your OLX ad *and* film affiliate links. This is the single highest-leverage growth item.
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

Suggested move: keep Amazon links for now (sunk setup, some users prefer it), add an Allegro link as a second button on each film card once the Allegro Affiliate account is approved. Measure both with the new click tracking and drop the loser.

## 4. Measure (unblocked today)

GoatCounter + outbound click events are now in the template. To activate:

1. Register at https://www.goatcounter.com with code **stare-aparaty** (must match the script URL in the template; if taken, pick another and update the template).
2. Done — no cookie banner needed, it's cookieless.
3. Watch: visits/day, `out-olx-*` events (which cameras get interest) and `out-amazon-*` events (which products get clicks).

## What changed in this session

- GoatCounter analytics + per-link outbound click events (template)
- OG/Twitter meta, canonical URL, branded `og-image.png`, `favicon.svg` (template + new files)
- `robots.txt` + `sitemap.xml`
- OLX price extraction in `build-catalog.js` → price chip on camera cards, cached in `olx_meta.json`
- `loading="lazy"` on below-the-fold images (template + card renderer)

## Your action items

1. Register the GoatCounter code `stare-aparaty`.
2. Add the site to Google Search Console, submit the sitemap.
3. Pick one camera and write the first guide page — validate the traffic thesis before scaling.
4. Apply to Allegro Affiliate Business.
