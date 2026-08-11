# AdSense

Everything in the repo is wired and shipping **disabled**. Going live is a
config edit plus a handful of steps that only exist in Google's dashboard.

## What the repo does

| Piece | Where |
|---|---|
| The one knob | `scripts/ads-config.json` |
| Loader tag, ad units, `ads.txt` | `renderAdsHead` / `renderAdUnit` / `renderAdsTxt` in `scripts/build-catalog.js` |
| Slot positions | `{{ADSENSE_HEAD}}`, `{{AD_SLOT_MIDPAGE}}`, `{{AD_SLOT_INGRID}}`, `{{AD_SLOT_FOOTER}}` in `templates/index.template.html`; `{{AD_SLOT_GUIDE}}` in `templates/guide.template.html` |
| Slot styling | `.ad-slot` block in the template's inline `<style>` |
| Privacy policy | `templates/privacy.template.html` → generated `polityka-prywatnosci.html`. §2/§3/§5/§8 switch on the ads flag — see "The policy text changes when you flip the flag" below |
| Footer disclosure | `{{ADS_DISCLOSURE}}` in `templates/index.template.html` |
| Agent/LLM index | `templates/llms.template.txt` → generated `llms.txt` (and inlined into `llms-full.txt`) |
| Publishing | `cp … dist/` lists in **both** `.github/workflows/discover-cameras.yml` and `deploy-pages.yml` |

With `enabled: false` the build emits zero ad markup and loads no third-party
script — the page is byte-identical to the pre-ads site apart from the footer
privacy link. That is deliberate: it keeps the site consent-banner-free until
ads actually run. Since 2026-08-11 the *disclosures* follow the same flag, so an
ads-off build no longer tells readers about advertising it doesn't serve.

## Placements

| Slot | Position | Format |
|---|---|---|
| `midpage` | Between the camera catalog and the B&W film section | responsive `auto` |
| `ingrid` | Last cell of the colour-film grid (7 cards + 1 ad = two full rows) | `fluid`, card-shaped |
| `footer` | Above the site footer | responsive `auto` |
| `guide` | Below the article on every `poradniki/*.html` page | responsive `auto` |

Every unit renders inside a labelled `<aside class="ad-slot">`. The **REKLAMA**
label is not optional here — the in-grid unit sits between affiliate product
cards that look like editorial recommendations, and an unlabelled ad in that
position would be misleading regardless of what Google's policy required.

Unfilled units collapse (`:has([data-ad-status="unfilled"])`) rather than
leaving an empty labelled frame.

No ads on `404.html` — AdSense prohibits serving on error pages.

## Going live

### 1. Get approved

Apply at <https://adsense.google.com> with `stareaparaty.com`. Google will ask
you to add the loader tag to the site: that is exactly step 2 below, so do the
config edit first, deploy, then hit "Request review".

Approval odds are better now that `poradniki/` ships **ten** guide pages of
original editorial content (five per-type, five per-model) — thin content was
the main risk with a bare affiliate catalog. If it's still rejected for "low
value content", the fix is more and deeper guides, not a resubmission.

### 2. Turn it on

```jsonc
// scripts/ads-config.json
{
  "enabled": true,
  "publisherId": "ca-pub-0000000000000000",  // your real id
  "slots": { "midpage": "", "ingrid": "", "footer": "", "guide": "" }
}
```

Publisher id alone is enough for review and for Auto ads. Leave the slot ids
empty until you've created the units — an empty slot is skipped, so Auto ads
can still place something there.

A malformed `publisherId` or slot id **fails the build**. That is intentional:
a typo would otherwise render perfectly valid HTML that earns nothing, and
nobody would notice for weeks.

Then `node scripts/build-catalog.js` and commit. The build regenerates
`index.html`, `polityka-prywatnosci.html`, `ads.txt`, `sitemap.xml`,
`llms.txt`, `llms-full.txt` and every page under `poradniki/` — the ad markup
*and* every disclosure that mentions it move together.

### 3. Create the four display units

AdSense → **Ads → By ad unit → Display ads**. Create one per placement, copy
each `data-ad-slot` number into the matching key in `ads-config.json`, rebuild.

Suggested names so the reports are readable: `stareaparaty-midpage`,
`stareaparaty-ingrid`, `stareaparaty-footer`, `stareaparaty-guide`.

The `guide` unit is the one most likely to earn: the guide pages are the only
real editorial content on the site, so they attract the search traffic and the
contextual match is far better than on a page of product cards.

### 4. Turn on the consent message (required — EU traffic)

**This is the one part with no code in this repo.** The GDPR consent banner is
Google's certified CMP; it ships inside `adsbygoogle.js` and is configured
dashboard-side. Do not hand-roll a banner — a self-built one is not
TCF-certified and would put the account out of compliance.

AdSense → **Privacy & messaging → European regulations**:

1. Create the message, set the language to **Polish**.
2. Consent options: allow both "Consent" and "Do not consent" (Google requires
   a reject button that's as easy to use as accept).
3. Add the link to `https://stareaparaty.com/polityka-prywatnosci.html`.
4. Publish, then confirm the banner appears on a fresh incognito load.

The "Zmień swoje zgody na reklamy" button on the privacy page calls
`googlefc.showRevocationMessage()`. It stays hidden until the CMP reports
ready, so it cannot be clicked into a no-op.

### 5. Verify

- `https://stareaparaty.com/ads.txt` → `google.com, pub-…, DIRECT, f08c47fec0942fa0`
- AdSense → Sites shows the domain as **Ready**, with no ads.txt warning
  (the warning can take ~24h to clear after the file goes live)
- Incognito load: consent banner appears, ad frames render, no console errors
- Privacy page: consent button appears and reopens the message

## Before the first live impression

**The data-controller question is settled — do not "fill it in".** §1 of the
policy names a natural person running the site privately, with
`support@stareaparaty.com` as the contact channel, which satisfies RODO
art. 13(1)(a-b). The absence of a company name, address and NIP is deliberate:
the site is not run under a registered business. Only if that changes (a
działalność gospodarcza starts operating the site) does §1 need that entity's
details — and then `PRIVACY_UPDATED` needs a bump too. Note this is separate
from the Allegro konto firmowe: being able to invoice Allegro does not make a
business the controller of this site's data.

## The policy text changes when you flip the flag

Since 2026-08-11 the ad *prose* is gated on `ads-config.json`, not just the ad
markup. With `enabled: false` the policy states that the site shows no ads and
sets no cookies, omits the "Dane reklamowe" bullet from §2, and drops consent
from the §5 legal bases — because none of that was true while ads were off.
Flipping `enabled: true` restores the full Google/AdSense disclosure word for
word. Same for the homepage footer sentence and the ads note in `llms.txt`.

Two consequences for this runbook:

- **Bump `PRIVACY_UPDATED`** in `scripts/build-catalog.js` when you flip the
  flag. The published policy genuinely changes, and §9 promises the date at the
  top moves when it does.
- You do **not** need to hand-edit the policy, the footer or `llms.txt` to
  announce the ads. The build does it. `llms.txt` is generated from
  `templates/llms.template.txt` — editing `llms.txt` directly loses the change
  on the next build, exactly like `index.html`.
