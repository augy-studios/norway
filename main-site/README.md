# There's Absolutely Norway

A directory-style PWA of small tools, each built on a free, key-less Norwegian
open-data API. Static HTML/CSS/JS, deployed on Vercel, with a handful of
serverless functions that step in as caching/normalizing proxies wherever an
upstream API needs one (CORS restrictions, a required identifying header, or
just some server-side rate-limit protection).

Live at `norway.uwuapps.org` (once configured).

## Pages

| Path | What it does | Upstream API |
|---|---|---|
| `/` | Directory / table of contents with search | - |
| `/stats` | Norway's Consumer Price Index: latest index, 12-month rate, chart, table | [SSB StatBank](https://www.ssb.no/en/api) |
| `/entities` | Look up any registered Norwegian company by org number or name | [Brreg Enhetsregisteret](https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html) |
| `/weather` | City forecasts (current, 24h, 7-day) plus peak UV index | [MET Norway Locationforecast](https://api.met.no/weatherapi/locationforecast/2.0/documentation), [NILU UV forecast](https://api.nilu.no/) |
| `/bank` | Official NOK exchange rates, a currency converter, and the key policy rate | [Norges Bank open data](https://www.norges-bank.no/en/topics/Statistics/open-data/) |
| `/library` | Search the National Library's digitized books, newspapers and images | [Nasjonalbiblioteket](https://api.nb.no/) |

Every data page follows the same shape: loading, error and empty states, a
retry path, and a serverless proxy in `/api` that adds a request timeout,
schema validation (so an upstream field change fails loudly instead of
silently), a best-effort per-instance rate limiter, and `Cache-Control`
headers tuned to how often that dataset actually changes.

## Design system

- **Theme**: 7 solid, static accent colours, picked via the palette button
  next to the theme switcher. Persisted in `localStorage` and applied through
  a `data-theme` attribute before first paint.
- **Look**: glassmorphism, translucent blurred panels over a flat,
  theme-coloured background.
- **Font**: Jua, everywhere, loaded with `font-display: swap`.
- **Icons**: inline SVG throughout, kept in a shared set in
  `assets/js/icons.js`.
- Shared styles and scripts live in `assets/css/theme.css` and
  `assets/js/theme.js` (the theme picker modal) plus `assets/js/icons.js`;
  each page adds its own small CSS/JS file alongside its `index.html`.

## Offline support

`sw.js` precaches the full app shell (every page's HTML/CSS/JS) on install, so
every route works offline once it's been visited. API responses use a
stale-while-offline strategy: a live request is always attempted first, and
the last successful response is served if the network is down.

## Local structure

```text
main-site/
  index.html, assets/css/home.css, assets/js/home.js   # directory page
  assets/css/theme.css, assets/js/theme.js             # shared theme + modal
  assets/js/icons.js                                   # shared SVG icon set
  stats/ entities/ weather/ bank/ library/              # one folder per page
  api/                                                  # Vercel serverless functions
  manifest.json, sw.js, vercel.json                     # PWA + hosting config
```

## Notes for whoever deploys this

Everything here runs on Vercel's static hosting and serverless functions,
plus the free tiers of each upstream API, so there's nothing to stand up on
a VPS: no database, no long-running process, no secret to manage. The `/api`
folder is Vercel serverless functions on the Node runtime; Vercel picks up
`.js` files under `/api` automatically, no extra config required.
