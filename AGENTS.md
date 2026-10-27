# CheckThisOut: guide for future coding sessions

Read README.md and this file first, then inspect the current code and Git status. This guide records decisions as of 27 October 2026; verify live configuration before relying on it. The user prefers concise explanations and concrete progress.

## Locations and architecture

- Local checkout: D:\code\CheckThisOut (moved from Documents\ChatGPT\Misc; do not use the old path).
- GitHub: https://github.com/bishopofbathandwells/CheckThisOut ; default branch main.
- Primary PWA: https://bishopofbathandwells.github.io/CheckThisOut/
- Alternate frontend: https://checkthisout.general-zodd.workers.dev/
- Recommendation API: https://checkthisout-recommendations.general-zodd.workers.dev
- Plain JavaScript modules, HTML and CSS; no frontend framework or bundler. scripts/build.mjs copies an explicit public asset allowlist into dist, including callback.html and .nojekyll. Never publish the whole checkout.
- GitHub Actions (.github/workflows/test.yml) tests, builds and deploys main to Pages. PRs test/build only. Cloudflare frontend and backend deployments are separate, manual operations.
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
- Live release verification: set PWA_URL to the target website and run node pwa-release-test.cjs. It uses an isolated browser, tests offline demo behaviour and mocks Spotify authorization; it does not make a paid recommendation request.
- Git ownership can differ in sandbox sessions. If Git reports dubious ownership, use a per-command safe.directory for this exact checkout; do not disable ownership checks globally.

## Deployment and credentials

- Push main to publish the primary frontend after successful CI. Root pnpm deploy instead updates the alternate Cloudflare frontend; it does NOT publish Pages.
- Backend: cd backend, install dependencies as needed, then pnpm exec wrangler deploy. Read existing ignored backend/wrangler.toml before changing configuration. Preserve the BUDGET Durable Object binding, migrations and stored counters/results.
- OPENAI_API_KEY is a Cloudflare secret, never frontend configuration. backend/wrangler.toml is deliberately ignored; backend/wrangler.example.toml is the shareable template. Do not print tokens or commit secrets, backups, private listening lists, screenshots or investigation notes.
- Public Spotify client ID in spotify.js is intentional. OAuth uses PKCE, not a Spotify client secret. Do not copy credentials from the user's unrelated Python playlist script.
- Registered callbacks must include localhost /callback, alternate Cloudflare /callback, and https://bishopofbathandwells.github.io/CheckThisOut/callback.html. Keep callbacks belonging to other tools. The user was asked to add the Pages callback; successful real-user sign-in there was not confirmed in this chat.
- CORS uses origins (https://bishopofbathandwells.github.io), not project paths. Spotify development-user access and backend account allowlisting are separate requirements.

## Product decisions to preserve

- Small personal app for friends/family, Android first, also desktop/iOS browsers.
- Discover NEW songs. Previously recommended and removed songs stay excluded even if batches are edited or deleted. Preserve independent exclusion registries during imports and migrations.
- Batch size is configurable 1-10, default 5. Daily allowance is 100 requests per allowlisted account (UTC), explicitly chosen by the user.
- Generate keeps a batch local. Save to Spotify creates its playlist. Open in Spotify creates it if needed and opens it. Never automatically create playlists on generation.
- Keep copies to a separate Spotify Keep playlist; optionally also add to Liked Songs using a preference. Imported keeps require explicit resync. Avoid duplicate writes.
- Remove deletes from the app batch and its Spotify batch playlist if saved; preserve permanent exclusion. No separate Already know this button.
- Scores are integers 1-5; unset is not a zero-star rating. Rating/button actions must keep expanded historical batches open. Show saved Spotify playlist names in history.
- Accept partial matched batches rather than discard useful results. No automatic paid top-up or retry. Keep UI instructions/debugging unobtrusive; request decision/usage details live in Preferences.
- Discovery customization is a saved free-text prompt. Sliders were deferred and are not a requirement.

## Recommendation context and known limitations

- Accessible Spotify playlist titles/artists are sampled (up to 200 tracks) as taste context; known songs and past recommendations are sent as exclusions. User consented to this metadata being sent to OpenAI. Do not silently add new data categories.
- Playlist context loads on the first recommendation request and is cached in memory until reload/disconnect. This is not a complete lifetime listening history. Spotify recent plays were unexpectedly incomplete for this account; user accepted that limitation.
- Ratings are currently stored locally and are NOT model inputs. Feeding scores into recommendations remains a possible future improvement, not implemented behaviour.
- Backend model is configured by OPENAI_MODEL; the last deployment used gpt-6-luna with low reasoning effort. Provider timeout 90s; client timeout 110s. Verify code/config before changing.
- The model can ignore exclusions; deterministic client filtering remains authoritative. Match Spotify IDs/URIs, ISRC and normalized title/artist; preserve Unicode and alternate-release handling. Never promise complete novelty from model instructions alone.
- Exclusions have explicit size guards (10,000 entries / 600,000 serialized characters); do not silently truncate them.
- Token usage and estimated USD cost are logged per request; missing usage is unknown, not zero. Cached results must not double-count cost. Decision audits explain accepted/rejected/unused candidates and matching sources.
- Authenticated GET /result?requestId=... retrieves the account's cached output without a new model call. Historical rechecks use current exclusions, not a preserved original snapshot; keep that limitation visible.

## Persistence and migration

- IndexedDB stores profiles per browser origin and account: batches, tracks, scores, keeps, preferences, exclusion registries and usage/decision logs. No Google account sync or cloud profile backup is implemented.
- Spotify tokens and pending PKCE state use sessionStorage, not exported backups. Cloudflare holds API secrets, quota state and cached request results, not the full browser profile.
- Moving between localhost, Cloudflare and Pages requires a fresh Export/Import backup. Connect the intended Spotify account on the destination before importing into that profile.
- Backups intentionally omit credentials and remote playlist links. Preserve original recommendation IDs, removed IDs, known-track metadata and logs; validate before changing state. Imports must not trigger Spotify writes.
- The checkout may contain ignored personal backups and diagnostic artifacts. Leave them private and intact. A fresh clone will not contain production backend configuration or those personal files.

Update this guide and README when behaviour or deployment changes. Do not claim a cloud deployment, Spotify action or backup restore succeeded without checking its result.
