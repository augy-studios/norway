# There's Absolutely Norway

A directory-style PWA of small tools built on free, key-less Norwegian open-data
APIs. Static HTML/CSS/JS, deployed on Vercel, with a few Vercel serverless
functions acting as caching/normalizing proxies where an upstream API needs one
(CORS-restricted, requires an identifying header, or benefits from server-side
caching and rate-limit protection).

Live at `norway.uwuapps.org` (once configured).

## Pages

| Path | What it does | Upstream API |
|---|---|---|
| `/` | Directory / table of contents with search | — |
| `/stats` | Norway's Consumer Price Index — latest index, 12-month rate, chart, table | [SSB StatBank](https://www.ssb.no/en/api) |
| `/entities` | Look up any registered Norwegian company by org number or name | [Brreg Enhetsregisteret](https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html) |
| `/weather` | City forecasts (current, 24h, 7-day) plus peak UV index | [MET Norway Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation), [NILU UV forecast](https://api.nilu.no/) |
| `/bank` | Official NOK exchange rates, a currency converter, and the key policy rate | [Norges Bank open data](https://www.norges-bank.no/en/topics/Statistics/open-data/) |
| `/library` | Search the National Library's digitized books, newspapers and images | [Nasjonalbiblioteket](https://api.nb.no/) |

Every data page follows the same shape: loading/error/empty states, a retry
path, and a serverless proxy in `/api` that adds a request timeout, schema
validation (so an upstream field change fails loudly instead of silently), a
best-effort per-instance rate limiter, and `Cache-Control` headers tuned to
how often that dataset actually changes.

## Design system

- **Theme**: 7 solid, static accent colours (no gradients, orbs, or blobs) —
  picked via the palette button next to the theme switcher. Persisted in
  `localStorage`, applied via a `data-theme` attribute before first paint.
- **Look**: glassmorphism (translucent, blurred panels) over a flat theme-
  coloured background.
- **Font**: Jua, everywhere, loaded with `font-display: swap`.
- **Icons**: inline SVG only — no emoji anywhere on the site. Shared set lives
  in `assets/js/icons.js`.
- Shared styles/scripts live in `assets/css/theme.css` and `assets/js/theme.js`
  (theme picker modal) + `assets/js/icons.js`; each page adds its own small
  CSS/JS file alongside its `index.html`.

## Offline support

`sw.js` precaches the full app shell (every page's HTML/CSS/JS) on install, so
every route works offline once visited. API responses are cached
stale-while-offline: a live request is always attempted first, and the last
successful response is served if the network is unavailable.

## Local structure

```text
main-site/
  index.html, assets/css/home.css, assets/js/home.js   — directory page
  assets/css/theme.css, assets/js/theme.js             — shared theme + modal
  assets/js/icons.js                                    — shared SVG icon set
  stats/ entities/ weather/ bank/ library/              — one folder per page
  api/                                                   — Vercel serverless functions
  manifest.json, sw.js, vercel.json                      — PWA + hosting config
```

## Notes for whoever deploys this

- Everything here runs on Vercel (static hosting + serverless functions) and
  the free tiers of each upstream API. **Nothing needs to be hosted
  separately on a VPS** — there's no database, no long-running process, and
  no API key/secret to manage.
- The `/api` folder is Vercel serverless functions (Node runtime, no extra
  config needed - Vercel detects `.js` files under `/api` automatically).
