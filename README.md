# norway

Source for **There's Absolutely Norway**, an open-source PWA of small tools
built entirely on free, key-less Norwegian open-data APIs — statistics,
company lookup, weather, exchange rates, and library search. See
[`main-site/README.md`](main-site/README.md) for what's actually in it and how
it's built.

Built on [Augy Studios](https://github.com/augystudios)' PWA template: static
HTML/CSS/JS, deployed on Vercel, with Vercel serverless functions used only
where an upstream API needs a caching/normalizing proxy (CORS restrictions, a
required identifying header, or just protecting a rate limit).

## Repo layout

- [`main-site/`](main-site/) — the actual site (everything Vercel deploys).
- [`LICENSE`](LICENSE) — MIT.
- [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — Contributor Covenant.

## Contributing

Issues and PRs are welcome — this is a hobby project, so no formal process,
just be reasonable and follow the Code of Conduct.
