# CheckThisOut

Personal music discovery PWA for phones, tablets and desktop browsers.

Live app: https://bishopofbathandwells.github.io/CheckThisOut/

Alternate Cloudflare frontend: https://checkthisout.general-zodd.workers.dev/

## Use the app

1. Open the live app and connect Spotify.
2. Choose 1–10 songs per batch in Preferences, optionally adding a music prompt.
3. Find new songs. Save to Spotify and Open in Spotify create playlists only when pressed.
4. Rate, Keep or Remove songs. Removed and previously recommended songs remain excluded.

Recommendations use a sample of up to 200 song titles/artists from accessible Spotify playlists and a growing exclusion list. Metadata is sent to OpenAI through an authenticated Cloudflare Worker. The final Spotify filter remains authoritative. The app currently has a 100-request daily limit per allowlisted account.

Install on Android using Chrome's Install app / Add to Home screen option. On iOS, open in Safari and choose Share → Add to Home Screen. Recommendations need a network connection; the cached app shell and previously saved local data remain available offline.

## Data and backups

Batches, ratings, keeps, preferences, exclusions and request/decision logs are stored in IndexedDB **per browser origin and Spotify account**. They are not automatically synced between devices. Moving from localhost to the live URL requires exporting and importing a backup, then reconnecting Spotify.

Export backup opens a Save file / Copy export dialog. Import restores local state but excludes login credentials and remote playlist links. Restored keeps can be explicitly saved to Spotify. Request usage and candidate rejection details are available in Preferences. Cost figures are estimates derived from provider token usage, not billing invoices.

## Develop

Requires Node.js 22+ and pnpm 10.11+.

```sh
pnpm install --frozen-lockfile
pnpm start
# In another terminal:
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

Local URL: http://127.0.0.1:8766/

On Windows, browser tests default to installed Edge; elsewhere they use Playwright Chromium. Override with PLAYWRIGHT_CHANNEL if needed.

## Publish the PWA

Push to `main` in https://github.com/bishopofbathandwells/CheckThisOut. GitHub Actions installs dependencies, runs unit/browser tests, builds only the public assets, and publishes the build to GitHub Pages. Pull requests run tests/build without publishing. GitHub Pages must use GitHub Actions as its publishing source.

The build copies an explicit allowlist into dist/. Never publish the project folder itself: it may contain local backups and development files. The OpenAI backend remains on Cloudflare and is deployed separately.

For an optional manual update of the alternate Cloudflare frontend:

```sh
pnpm build
pnpm exec wrangler login
pnpm exec wrangler deploy --config wrangler.app.toml
```

## Spotify and recommendation backend

The public Spotify client ID is in spotify.js. The app uses PKCE and never needs a Spotify client secret.

Register these exact callback URLs in the Spotify application's settings:

- http://127.0.0.1:8766/callback
- https://checkthisout.general-zodd.workers.dev/callback
- https://bishopofbathandwells.github.io/CheckThisOut/callback.html

Keep any existing callback URLs used by other tools. Spotify development access and the backend account allowlist still apply.

For a new backend deployment, copy backend/wrangler.example.toml to backend/wrangler.toml, set allowed origins/users, and store OPENAI_API_KEY using `wrangler secret put`. Never place API keys in frontend files or Git. The local production backend configuration is deliberately ignored by Git.

```sh
cd backend
pnpm install --frozen-lockfile
pnpm exec wrangler secret put OPENAI_API_KEY
pnpm exec wrangler deploy
```

Deployment of the frontend does not redeploy or reset the backend's durable request history.
