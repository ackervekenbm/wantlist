# wantlist

A single-user, **deferred shopping researcher**. You type a vague buying idea
("a good fan to add to my indoor biking setup") and walk away. A background
worker researches it — Belgium-focused, EUR, whole-market (big players + specialists) —
and later you get 3–5 ranked picks with shop, ballpark price, reason, live link.
English summaries. Runs on a Raspberry Pi / OpenMediaVault at €0.

One npm package: Express + better-sqlite3 backend (`src/server/`), React +
Vite frontend (`src/client/`), research engine in `src/server/research/`,
shared types in `src/types/`.

## Build, lint, verify

```bash
npm install       # install deps (uses package-lock.json, commit it)
npm run build     # = typecheck && lint && vite build && tsc -p tsconfig.server.json  ← the verify step
npm test          # vitest unit tests (tests/, node env)
```

Installs are **script-free**: `.npmrc` sets `ignore-scripts=true`.
`better-sqlite3` ships `prebuilds/<platform>.node` (glibc + musl, amd64 +
arm64), so nothing needs compiling, but npm would otherwise run its legacy
implicit `node-gyp rebuild` on every install, which wants python3/make/g++ and
discards the shipped binary. The Dockerfile relies on this; a dependency that
genuinely needs an install script cannot be added without revisiting `.npmrc`.

The server compiles with `tsc` (CommonJS) into `dist-server/server/` — `rootDir`
is `src/` because the server imports `src/types/` — so the entry point is
`dist-server/server/index.js` (`npm start`, the Dockerfile `CMD`).

**Verification for every change is `npm run build && npm test`.** CI runs the
`check` job (`npm ci && npm run build && npm test`, `.github/workflows/ci.yml`)
on every PR and push to `main`. PRs that touch the image also run the
**smoke** job (`.github/workflows/docker-build.yml`): build the image, boot it
without API keys, poll `/api/health`, and assert `/api/ideas` and the
cache headers (app shell `no-cache`, `/assets/*` immutable). On `main` the image
is then built natively per arch (amd64 + arm64 runners, no QEMU) and combined
into the multi-arch `ghcr.io/ackervekenbm/wantlist:latest` / `:<sha7>`.

## Issue-first workflow (MANDATORY)

Before starting any new work item, create a GitHub issue:

```bash
gh issue create --title "<what>" --body "..."   # → gives an issue number
```

- Name the branch `fix/...`, `feat/...` or `chore/...` (one per issue).
- Put `Fixes #<n>` on its own line in the PR body so the issue auto-closes on merge.
- The PR author never merges their own PR — hand over to a reviewer to merge.

## Architecture

- `src/server/index.ts` — bootstrap only: env, DB, requeue ideas a restart
  interrupted (`recoverInterrupted`), engine + worker, `listen` on
  `0.0.0.0:3000` (`HOST`/`PORT`), and a SIGTERM/SIGINT shutdown that stops the
  worker, drains the server and closes the DB.
- `src/server/app.ts` — `createApp({db, worker, missingKeys, clientDist})`:
  every `/api/*` route, JSON 404s/400s/500s, and the built client
  (`/assets/*` immutable, the shell `no-cache`, SPA fallback). Route tests drive
  it with supertest (`tests/app.test.ts`), no listening socket.
- `src/server/db.ts` — better-sqlite3 (WAL) in `data/wantlist.db` (`DATA_DIR`).
  Tables `ideas` and `picks`. Migrations are an append-only list counted by
  `PRAGMA user_version`; each step must also tolerate databases from before
  versioning. Idea lifecycle: `queued` → `researching` (`claimIdea`) →
  `done` (`completeIdea`: picks + status in one transaction) or a failure
  (`failIdea`): back to `queued` with `next_attempt_at` when it will be
  retried, else `error`. Failures and re-runs **keep the previous picks** until
  new ones replace them. All timestamps leave the API as ISO-8601 UTC.
- `src/server/worker.ts` — in-process worker with per-instance state. A pass
  researches up to `WORKER_QUEUE_CAP` (default 3) **due** ideas, one at a time.
  It sleeps until the earlier of the next scheduled retry or
  `WORKER_INTERVAL_MS` (default 15 min); adding or re-running an idea calls
  `kick()`, and a kick during a pass queues a follow-up pass. Retry policy
  (`retryAt`): only retryable `ModelError`s retry, 15 min doubling to 6 h, at
  most 5 attempts, never before a quota reset the router reports; when every
  model is out of quota the pass stops early. `state().current` carries the
  research step the pipeline reports, shown live on the card.
- `src/server/research/pipeline.ts` — `PipelineEngine` implements `ResearchEngine`
  with a **no-grounding** flow: plan (queries) → Serper search → candidate
  selection → read the top pages → verify → **offer check**. It returns the
  brief (summary + criteria, stored on the idea) with the picks.
  The offer check opens every surviving offer's page once (a per-run
  `PageCache`, so pages read for verification are reused; 6 in flight): dead
  offers are dropped, and price, stock, photo and rating are taken from the
  shop page's own product data (`checked: true`) over what search or the model
  saw. Offers sort in stock → priced → cheapest; picks sold out everywhere sink
  to the end, otherwise the model's ranking stands.
  Gemini cannot browse on the free tier, so all real searching/reading happens
  server-side. Each step reports a human-readable `onProgress` step. When
  every query fails, the most telling search error is rethrown (a refused
  Serper key or spent credits beats "no results").
- `src/server/research/errors.ts` — `ResearchError` with a `kind` that decides
  what happens next (table in the file): `transient` / `quota` / `invalid`
  retry, `unavailable` / `blocked` / `no-results` stop. Providers and the
  search layer only ever throw these.
- `src/server/research/llm.ts` — `LlmProvider` and `ModelRouter`, an ordered
  fallback chain. Per entry: `quota` benches it until the reported reset (an
  hour if none) and advances at once; `unavailable` (404 model, refused key)
  benches it for a day; `transient` backs off on the same entry (max 3)
  then advances; `invalid` advances; `blocked` fails the call.
  `generate(args, parse)` runs the step's normalizer inside the router, so an
  answer the normalizer rejects (no queries, no candidate from the result set)
  tries the next model. All benched: wait if the earliest reset is ≤ 90 s
  (per-minute limits), else throw `allModelsOut` with the time to that reset,
  which the worker uses as the retry time. `health()` feeds `/api/status`.
- `src/server/research/gemini.ts` — `GeminiProvider` (raw `fetch`, key in the
  `x-goog-api-key` header). 429s are classified from the body
  (`parseGoogleError`: QuotaFailure `quotaId`, RetryInfo `retryDelay`):
  per-day quota → bench until **midnight Pacific** (Gemini's reset), per-minute
  → bench for `retryDelay`. 3.x grounding-with-search is paid-only, 2.5-flash is
  retired for new users — see `docs/plan.md`.
- `src/server/research/prompts.ts` — prompts, response schemas, user-message
  builders and normalizers for the three model steps; `offers.ts` — URL
  normalization, supplier ordering and product de-duplication; `json.ts` —
  `parseJsonLoose` for fenced/prose-wrapped JSON.
- `src/server/research/openai.ts` — generic OpenAI-compatible chat-completions
  provider (JSON via `response_format` + schema-in-prompt); Groq and
  OpenRouter are thin configs over it.
- `src/server/research/chain.ts` — builds the provider chain from env:
  `GEMINI_MODEL` (primary) → `MODEL_CHAIN` (Gemini fallbacks, default
  `gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite`) → optional
  `GROQ_API_KEY` → optional `OPENROUTER_API_KEY`.
- `src/server/research/product.ts` — structured product data from a shop page:
  schema.org JSON-LD (`Product`, `@graph`, `ProductGroup` variants, `Offer` /
  `AggregateOffer`; EUR only; cheapest in-stock offer wins), OpenGraph /
  `product:*` meta as the fallback. `parsePriceEur` reads Belgian formats
  ("€ 1.299,00", "129,-"; a lone separator before exactly three digits is a
  thousands separator). Prices are numbers (EUR) everywhere from here on; rows
  stored before that still hold text and are parsed on read.
- `src/server/research/http.ts` — `fetchPage`: one GET (browser-like UA,
  nl-BE languages, 12 s, body capped at 1.5 MB) gives liveness, the visible
  text (page chrome dropped, `<main>` preferred) and the product data. Only
  404/410, a bounce to the home page, or a "not found" title count as
  **dead**; 401/403/429/5xx are bot walls or shop trouble and count as
  unknown, so big marketplaces are not dropped. Never throws.
- `src/client/` — React UI. `App.tsx`: capture form, Wanted / Bought /
  Archived tabs, filter (more than 8 ideas), worker chip (researching / queue /
  out of quota until… / research off), undo toast. `hooks/useIdeas.ts` owns
  all server state: polls every 5 s while research is queued or running, else
  every 60 s, and on tab focus; a removal is hidden at once and only DELETEd
  after a 6 s undo window (flushed with `keepalive` on `pagehide`).
  `components/IdeaCard.tsx` (collapsible, collapse remembered in
  localStorage via `lib/storage.ts`), `PickCard.tsx` (checked price ✓ vs "≈"
  search price, stock, rating, caveat, other shops, "I bought this"),
  `IdeaForm.tsx` (shared by capture and edit; Enter submits, Shift+Enter is a
  new line; `parseBudget` mirrors the server's limits). Styles: CSS tokens in
  `styles.css` (dark default, light via `prefers-color-scheme`); new styles
  use the `--*` tokens, never hardcoded colors. Client tests sit next to the
  code (`*.test.tsx`, jsdom) and drive the real hook and components against
  an in-memory API (`src/client/test/fakeApi.ts`).
- **Lists vs research status.** `list` (wanted / bought / archived) is the
  user's side and independent of `status`; only `wanted` ideas are
  researched (`dueIdeaIds`), and re-running moves an idea back to wanted.
  `PATCH /api/ideas/:id` edits text / budget / notes / list; moving to
  bought with `boughtPickId` stores a snapshot of that pick (picks are
  replaced on re-research), `boughtPickId: null` = bought something else.
  Budget and notes reach every prompt (`describeIdea` in `prompts.ts`).
- `scripts/spike.ts` — run the research engine against a real key without the
  UI: `npm run spike "some idea"`.

## Platform caveats (important)

- **No API keys in the repo.** `GEMINI_API_KEY` + `SERPER_API_KEY` come only
  from the environment (compose `.env` on the Pi, or `.env`/env var in dev).
  The repo is public.
- **Free-tier quotas move.** Google does not publish fixed limits; they are
  per-project and only visible in AI Studio. Backoff on 429s, cap the queue,
  surface errors per idea instead of failing the run.
- research quality is only as good as the pass-1 prompt + acquired page text;
  the parsers deliberately **drop** anything unverifiable (invalid URLs,
  pass-2 URLs not in the candidate set) rather than trusting the model.
- Tests never touch the network: providers are tested with `fetch` stubbed
  (real Google/OpenAI error shapes), the pipeline with a scripted model, a fake
  search provider and `http.ts` mocked (`tests/pipeline.test.ts`).

## Dependencies / Dependabot

- Dependabot majors stay enabled. The `typescript` major is ignored in
  `.github/dependabot.yml` (TypeScript 7 is outside typescript-eslint's peer
  range); lift it once typescript-eslint supports it.
- The runtime image is `node:22-alpine` and installs production dependencies
  only; `better-sqlite3` majors that change the native ABI or drop a musl
  prebuild are caught by the smoke job before merge.

## Deployment

Any 64-bit Docker host; OpenMediaVault's Compose plugin is the reference route
(data in the plugin's Data folder, `wantlist-data`), plain Docker Compose
(`docker-compose.yml`, named volume) the other. Guide and settings table in
`docs/deployment.md`; keep it generic (no host names, IPs or other apps):
the owner's actual host setup is tracked outside this repo. Every setting the
server reads is passed through in both compose files with its default.
The GHCR package is public, so the OMV plugin's **Pull** works anonymously.
The process runs as the image's unprivileged `node` user (uid 1000):
`docker-entrypoint.sh` starts as root only to hand `/app/data` to `node`
(files a root-run image or a restore left there) and then drops to it with
`su-exec`. The smoke job checks that the app runs as `node`, that a root-owned
volume (with a planted symlink, which must not be followed) is taken over and
boots, and that `--user 1000:1000` works.
Dev machine has no Docker — container builds are validated by CI on GitHub
runners.