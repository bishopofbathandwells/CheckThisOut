# CheckThisOut

Personal music discovery PWA for phones, tablets and desktop browsers.

Live app: https://bishopofbathandwells.github.io/CheckThisOut/

Alternate Cloudflare frontend: https://checkthisout.general-zodd.workers.dev/

## Use the app

1. Open the live app and connect Spotify.
2. Choose 1–10 songs per batch in Preferences, optionally adding a music prompt.
3. Find new songs. Save to Spotify and Open in Spotify create playlists only when pressed.
4. Rate, Keep or Remove songs. Removed and previously recommended songs remain excluded.

Preferences includes Report issue to the developer, which opens an email draft to general-zodd@gmail.com with the app name and page address (no query string, account details or listening data). The user reviews and sends it using their email app.

Recommendations use a sample of up to 200 song titles/artists from accessible Spotify playlists, up to 100 rated/kept songs as feedback, and a growing exclusion list. Metadata is sent to OpenAI through an authenticated Cloudflare Worker. The final Spotify filter remains authoritative. Repeated model candidates are filtered during selection; useful unique matches are retained without an automatic model retry. The app currently has a 50-request daily limit per allowlisted account.

Install on Android using Chrome's Install app / Add to Home screen option. On iOS, open in Safari and choose Share → Add to Home Screen. Recommendations need a network connection; the cached app shell and previously saved local data remain available offline.

## Data and backups

Batches, ratings, keeps, preferences, exclusions and request/decision logs are stored in IndexedDB **per browser origin and Spotify account**. Signed-in allowlisted profiles sync through the backend to Cloudflare D1. A fresh browser restores the cloud profile after Spotify sign-in. Unsynced offline changes remain on the device until it reconnects. Browser origins retain independent local copies.

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

Push to `main` in https://github.com/bishopofbathandwells/CheckThisOut. GitHub Actions installs dependencies, runs unit/browser tests, builds only the public assets, and publishes the same build to GitHub Pages and the alternate Cloudflare frontend. Pull requests run tests/build without publishing. GitHub Pages must use GitHub Actions as its publishing source.

The build copies an explicit allowlist into dist/. Never publish the project folder itself: it may contain local backups and development files. The OpenAI backend remains on Cloudflare and is deployed separately.

Cloudflare CI authentication: create a Cloudflare API token with Workers Editor access scoped to the existing `checkthisout` frontend Worker (or the Edit Cloudflare Workers template scoped to this account). Store its value as the repository Actions secret `CLOUDFLARE_API_TOKEN` under Settings → Secrets and variables → Actions. The account ID in the workflow is public configuration. Do not put the token in source files or chat. The token does not need the OpenAI API key.

Both deployment jobs require the successful test/build job and run independently. A missing or expired Cloudflare token fails the Cloudflare job explicitly while allowing Pages to publish. After adding or replacing the secret, rerun the failed job or use Run workflow on main. Pull requests do not deploy or receive the deployment token.

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

## Manually deploy the recommendation backend from GitHub

In GitHub Actions, select **Deploy recommendation backend** → **Run workflow** → branch **main**. This workflow never runs on a push or pull request. It tests the backend, validates its bundle, deploys the existing Worker and checks readiness.

It uses the same `CLOUDFLARE_API_TOKEN` repository secret; that token must permit deployment of both CheckThisOut Workers. `backend/wrangler.ci.toml` preserves the existing BUDGET binding/migration and uses `--keep-vars` to retain production model, allowed origins/users and ENABLED settings. The existing Cloudflare OPENAI_API_KEY secret is retained. This workflow updates code; change production variables separately through Cloudflare or the ignored local production configuration. It does not create or reset profile data, quotas or cached requests.

Preferences also includes an app name (Hidden Gems / What a Find / Check This Out) and theme (Precision / Paper / Studio). Both choices are saved per profile and included in backups.

Signed-out users start with Connect Spotify. No sample recommendation batches are generated. Existing legacy batches remain readable and restorable.

Spotify playlist context is cached on this device per account for 24 hours, surviving reloads and app reopening. It refreshes automatically on the next recommendation request after expiry; there is no refresh button. Recent plays and Liked Songs are still checked on every request.

Playlist context preloads asynchronously after successful Spotify connection (including a restored signed-in session). Recommendation generation joins any in-flight load, avoiding duplicate reads. Fresh per-account disk caches survive disconnect/reconnect. Prefetch failure is retried on demand; it does not block sign-in or make model calls.

Disconnected users can browse the most recently used Spotify profile as a clearly labelled read-only preview. Rating/Keep/Remove/import and Spotify writes require reconnecting. A fresh browser still shows Connect Spotify; legacy demo profiles are not used for the preview. Per-account data and caches remain separate.

## Cloud profiles and feedback

D1 database: checkthisout-profiles; Worker binding: PROFILES. Profile writes use revision checks, not blind overwrites. Five recent revisions are retained in chunks to stay below D1 row limits. Profiles are capped at 8 MB; oversize or failed sync leaves local data unchanged. Cloud sync has no model cost or recommendation-quota use.

Synced: batches and their same-account Spotify playlist links, ratings, keeps, preferences, exclusion history and request/decision logs. Not synced: Spotify/OAuth tokens, OpenAI secrets, playlist cache, transient in-flight requests or local account metadata. Backup exports remain independent and intentionally omit remote playlist links.

Sync runs after sign-in, on profile changes, on returning to the app and on network reconnection. Preferences → Cloud storage shows status and Sync now. Profiles merge automatically: distinct batches and request logs combine; ratings, Keeps and individual preferences use per-item edit times, including removals. Previously recommended/removed exclusions accumulate permanently. Existing profiles without edit timestamps combine histories and retain cloud preferences until edited. Device clocks determine the latest edit. Choosing cloud preserves a device recovery copy available for export. Use backups before resolving a conflict if you want an additional independent copy.

Schema migrations are separate from normal deployment. From the checkout: node node_modules/wrangler/bin/wrangler.js d1 migrations apply PROFILES --config backend/wrangler.ci.toml --remote. This requires D1 access; the GitHub deploy token can continue deploying the existing binding with Workers deployment permissions. Do not recreate the database or reset the existing BUDGET Durable Object.

Ratings 4-5 are positive evidence, 1-2 negative and 3 neutral. Keeps are positive evidence; explicit scores take precedence if they conflict. Remove remains exclusion only. At most 100 feedback songs are sent (recent batches first), with titles/artists and score/Keep flags only. Feedback affects the next new model request, not an already generated batch.

Spotify 429 responses respect Retry-After. Without a reset time, the client backs off conservatively, distinguishes API-quota exhaustion and preserves the sign-in session. Waiting locally does not guarantee Spotify's quota has reset.
