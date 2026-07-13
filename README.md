# WikiPulse

WikiPulse is a production-ready static app for exploring what the world is reading on Wikipedia. It ships with local snapshot data so the app works even when live Wikimedia requests are slow or blocked, and it upgrades to live data in the browser when available.

## Local Development

```sh
pnpm install --frozen-lockfile
pnpm run dev
```

Open `http://localhost:5173`.

## Validate

```sh
pnpm run test
pnpm run build
pnpm run preview
```

Preview serves the production build at `http://localhost:4173`.

## Cloudflare Pages

Use these settings:

- Build command: `pnpm run build`
- Output directory: `dist`
- Install command: `pnpm install --frozen-lockfile`

## Cloudflare Workers Static Assets

The included `wrangler.toml` points Workers static assets at `./dist`:

```sh
pnpm run build
wrangler deploy
```
