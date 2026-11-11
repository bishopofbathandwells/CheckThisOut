# CheckThisOut: guide for future coding sessions

Read README.md and this file first, then inspect the current code and Git status. This guide records decisions as of 27 October 2026; verify live configuration before relying on it. The user prefers concise explanations and concrete progress.

## Locations and architecture

- Local checkout: D:\code\CheckThisOut (moved from Documents\ChatGPT\Misc; do not use the old path).
- GitHub: https://github.com/bishopofbathandwells/CheckThisOut ; default branch main.
- Primary PWA: https://bishopofbathandwells.github.io/CheckThisOut/
- Alternate frontend: https://checkthisout.general-zodd.workers.dev/
- Recommendation API: https://checkthisout-recommendations.general-zodd.workers.dev
- Plain JavaScript modules, HTML and CSS; no frontend framework or bundler. scripts/build.mjs copies an explicit public asset allowlist into dist, including callback.html and .nojekyll. Never publish the whole checkout.
- GitHub Actions (.github/workflows/test.yml) tests, builds and deploys the same main artifact to Pages and the Cloudflare frontend in independent jobs. PRs test/build only. The backend has a separate manual-only GitHub workflow (deploy-backend.yml); it never deploys on pushes.
- app.js handles UI, profile persistence, backups and batch actions; spotify.js handles PKCE/auth/API writes; history.js reads Spotify context; discovery.js calls the backend; recommendations.js handles matching/exclusions; backend/worker.mjs handles authorization, model calls, usage and durable request state.

## Development and verification

Requires Node 22+ and pnpm 10.11 (see package.json/lockfile).

```sh
pnpm install --frozen-lockfile
pnpm start
pnpm test
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build
```

- Development server: http://127.0.0.1:8766/ ; run from this checkout. Browser regression tests require it running.
- Windows tests use installed Edge by default; other platforms use Playwright Chromium. PLAYWRIGHT_CHANNEL overrides this.
- Unit and browser suites cover filtering, OAuth, explicit playlist actions, history expansion and backup restoration. Run relevant checks for the change; documentation-only edits need no full test run.
- Additional focused scripts include partial-batch-test.cjs, batch-size-test.cjs and ten-song-test.cjs.
- Live release verification: set PWA_URL to the target website and run node pwa-release-test.cjs. It uses an isolated browser, tests offline sign-in entry and mocks Spotify authorization; it does not make a paid recommendation request.
- Git ownership can differ in sandbox sessions. If Git reports dubious ownership, use a per-command safe.directory for this exact checkout; do not disable ownership checks globally.

## Deployment and credentials

- Push main to publish both frontends after successful CI. Cloudflare requires the CLOUDFLARE_API_TOKEN repository Actions secret; a missing token fails that job explicitly. workflow_dispatch can retry deployment after secret setup. Root pnpm deploy is a manual alternative for the Cloudflare frontend only.
- Backend: use Actions → Deploy recommendation backend → Run workflow on main. CI uses backend/wrangler.ci.toml with --keep-vars to retain production variables and existing secrets. Alternatively, cd backend, install dependencies as needed, then pnpm exec wrangler deploy. Read existing ignored backend/wrangler.toml before changing configuration. Preserve the BUDGET Durable Object binding, migrations and stored counters/results.
- OPENAI_API_KEY is a Cloudflare secret, never frontend configuration. backend/wrangler.toml is deliberately ignored; backend/wrangler.example.toml is the shareable template. Do not print tokens or commit secrets, backups, private listening lists, screenshots or investigation notes.
- Public Spotify client ID in spotify.js is intentional. OAuth uses PKCE, not a Spotify client secret. Do not copy credentials from the user's unrelated Python playlist script.
- Registered callbacks must include localhost /callback, alternate Cloudflare /callback, and https://bishopofbathandwells.github.io/CheckThisOut/callback.html. Keep callbacks belonging to other tools. The user was asked to add the Pages callback; successful real-user sign-in there was not confirmed in this chat.
- CORS uses origins (https://bishopofbathandwells.github.io), not project paths. Spotify development-user access and backend account allowlisting are separate requirements.

## Product decisions to preserve

- Small personal app for friends/family, Android first, also desktop/iOS browsers.
- Discover NEW songs. Previously recommended and removed songs stay excluded even if batches are edited or deleted. Preserve independent exclusion registries during imports and migrations.
- Batch size is configurable 1-10, default 5. Daily allowance is 50 requests per allowlisted account (UTC), explicitly chosen by the user.
- Generate keeps a batch local. Save to Spotify creates its playlist. Open in Spotify creates it if needed and opens it. Never automatically create playlists on generation.
- Keep copies to a separate Spotify Keep playlist; optionally also add to Liked Songs using a preference. Imported keeps require explicit resync. Avoid duplicate writes.
- Remove deletes from the app batch and its Spotify batch playlist if saved; preserve permanent exclusion. No separate Already know this button.
- Scores are integers 1-5; unset is not a zero-star rating. Rating/button actions must keep expanded historical batches open. Show saved Spotify playlist names in history.
- Accept partial matched batches rather than discard useful results. No automatic paid top-up or retry. Keep UI instructions/debugging unobtrusive; request decision/usage details live in Preferences.
- Discovery customization is a saved free-text prompt. Sliders were deferred and are not a requirement.

## Recommendation context and known limitations

- Accessible Spotify playlist titles/artists are sampled (up to 200 tracks) as taste context; known songs and past recommendations are sent as exclusions. User consented to this metadata being sent to OpenAI. Do not silently add new data categories.
- Playlist context loads on the first recommendation request and is cached per account in IndexedDB for 7 days, surviving reload and reopening; no manual refresh button. Liked Songs/recent listening and song searches have device-only 24-hour caches; writes and playlist write verification remain fresh. Cache is excluded from backup exports. This is not a complete lifetime listening history. Spotify recent plays were unexpectedly incomplete for this account; user accepted that limitation.
- Ratings and Keeps now guide model recommendations: up to 100 title/artist pairs with scores/Keep flags. 4-5 positive, 1-2 negative, 3 neutral. Remove is exclusion only.
- Backend model is configured by OPENAI_MODEL; the last deployment used gpt-6-luna with low reasoning effort. Provider timeout 90s; client timeout 110s. Verify code/config before changing.
- The model can ignore exclusions; deterministic client filtering remains authoritative. Match Spotify IDs/URIs, ISRC and normalized title/artist; preserve Unicode and alternate-release handling. Never promise complete novelty from model instructions alone.
- Exclusions have explicit size guards (10,000 entries / 600,000 serialized characters); do not silently truncate them.
- Token usage and estimated USD cost are logged per request; missing usage is unknown, not zero. Cached results must not double-count cost. Decision audits explain accepted/rejected/unused candidates and matching sources.
- Authenticated GET /result?requestId=... retrieves the account's cached output without a new model call. Historical rechecks use current exclusions, not a preserved original snapshot; keep that limitation visible.

## Persistence and migration

- IndexedDB stores profiles per browser origin and account: batches, tracks, scores, keeps, preferences, exclusion registries and usage/decision logs. Cloud profiles now sync via authenticated Cloudflare D1; see README Cloud profiles and feedback. Local data still supports offline use.
- Spotify tokens and pending PKCE state use sessionStorage, not exported backups. Cloudflare holds API secrets, quota state and cached request results; D1 separately stores synced user profiles. OAuth tokens remain local and are never synced.
- Moving between localhost, Cloudflare and Pages requires a fresh Export/Import backup. Connect the intended Spotify account on the destination before importing into that profile.
- Backups intentionally omit credentials and remote playlist links. Preserve original recommendation IDs, removed IDs, known-track metadata and logs; validate before changing state. Imports must not trigger Spotify writes.
- The checkout may contain ignored personal backups and diagnostic artifacts. Leave them private and intact. A fresh clone will not contain production backend configuration or those personal files.

Update this guide and README when behaviour or deployment changes. Do not claim a cloud deployment, Spotify action or backup restore succeeded without checking its result.

- Visible app name is selectable in Preferences: Hidden Gems (default), What a Find or Check This Out. Saved per profile and in backups. Preserve the existing manifest id, database names and URLs when changing branding; the static install manifest uses Hidden Gems. All three themes are selectable in Preferences: Precision (default, graphite/lime), Paper (light/cobalt), and Studio (navy/cyan). Theme is stored per profile and included in backups; old backups default to Precision. Keep all themes compact and preserve functional/accessibility parity.

- Also add kept songs to Spotify Liked Songs defaults to enabled for new profiles and profiles/backups without the preference. Preserve explicitly saved false. Existing keeps are not automatically written to Spotify; their local records now sync to D1.

- Signed-out users see Connect Spotify as the main action; sample generation was removed. Keep the legacy catalog/profile storage for existing backup compatibility. Tests seed legacy batches with test-fixtures.cjs rather than exposing demo generation.

Playlist context preloads asynchronously after successful Spotify connection (including a restored signed-in session). Recommendation generation joins any in-flight load, avoiding duplicate reads. Fresh per-account disk caches survive disconnect/reconnect. Prefetch failure is retried on demand; it does not block sign-in or make model calls.

- Disconnect shows the latest Spotify account’s saved batches read-only with a disconnected label. Spotify profiles and their 7-day playlist caches remain separate. Tests use mock signed-in profiles for legacy data.

Disconnected users can browse the most recently used Spotify profile as a clearly labelled read-only preview. Rating/Keep/Remove/import and Spotify writes require reconnecting. A fresh browser still shows Connect Spotify; legacy demo profiles are not used for the preview. Per-account data and caches remain separate.

D1: binding PROFILES / database checkthisout-profiles. Migrations in backend/migrations are applied separately before deployment. Cloud sync is revision-checked, offline-first and account-isolated. It automatically combines batches/logs and uses per-item edit times for ratings, Keeps and individual settings; exclusions accumulate. Legacy untimed preferences favour the cloud. Preference recovery exports remain available. Tokens, playlist cache and transient requests are excluded. The legacy Spotify user.id remains the allowlist/profile key; do not silently migrate identity fields. Sync does not spend model quota. Tests include cloud-sync.test.mjs, backend/profile-store.test.mjs and cloud-profile-test.cjs.

Developer usage: GET /developer/usage is restricted to DEVELOPER_SPOTIFY_USER after Spotify verification and allowlist checking; fails closed when unset. Returns only userId, saved batch count, latest batch date and last sync for allowlisted accounts. Frontend developerSpotifyUserId controls Preferences ? Developer visibility only. Keep these IDs aligned; no model calls or automatic polling.

Artist exclusions: profile.excludedArtists (max 500 names) is synced/backed up and sent as excludedArtists to /recommend. The model receives excluded_artists; selectDiscoveries filters normalized names before lookup and all available Spotify artist credits after matching. Artist removal affects the current batch and its saved Spotify playlist only; existing keeps/other batches are retained. Preferences artist editor shares the Discovery preferences label row. Keep song rows at their measured pre-change height; artist-test.cjs covers all themes, widths 320?1280 and retry-safe saved playlist removal.

Playlist fallback: playlistReadProxyEnabled is enabled. Deploy the backend endpoint before publishing the frontend. Browser playlist GET failures can use /spotify/playlist-items, which verifies account access and proxies a fixed Spotify host/path with bounded pagination and no redirects. No arbitrary URL/method proxy and no model calls. Test with backend/playlist-proxy.test.mjs and playlist-proxy-test.cjs.

Cache limits: playlists 7 days, 1,000 unique tracks, 200 rows per playlist, 100 sampled playlists, 20 playlist-list pages and 100 track pages. History/search caches use SpotifyReadCache in history.js with per-account cache:spotify:<id> records in the existing IndexedDB profile store, separate from cloud/backup projection. Search cache max 500 successful match/no-match results; errors are not cached. Active Spotify cooldown blocks model spending. Tests: history.test.mjs and spotify-read-cache-test.cjs.
