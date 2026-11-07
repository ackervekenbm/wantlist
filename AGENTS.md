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
  selection → fetch top pages → verify → URL-liveness filter. Gemini cannot
  browse on the free tier, so all real searching/reading happens server-side.
- `src/server/research/llm.ts` — `ModelError`, `LlmProvider` interface, and
  `ModelRouter`: an ordered fallback chain across models/providers. A
  daily-quota 429 memoizes that model as unavailable (until Retry-After / next
  00:00 UTC) and advances immediately; 5xx/network get exponential backoff on
  the same entry (max 3) before advancing; non-retryable errors fail the idea.
- `src/server/research/gemini.ts` — `GeminiProvider` (`fetch` client for the
  Gemini REST API) plus the prompts, JSON schemas, and the parsers presenters
  rely on. 3.x grounding-with-search is paid-only, 2.5-flash is retired for new
  users, and 3.6-flash has been seen 503ing on heavy JSON calls — see
  `docs/plan.md`.
- `src/server/research/openai.ts` — generic OpenAI-compatible chat-completions
  provider (JSON via `response_format` + schema-in-prompt, reuses
  `parseJsonLoose`); Groq and OpenRouter are thin configs over it.
- `src/server/research/chain.ts` — builds the provider chain from env:
  `GEMINI_MODEL` (primary) → `MODEL_CHAIN` (Gemini fallbacks, default
  `gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite`) → optional
  `GROQ_API_KEY` → optional `OPENROUTER_API_KEY`.
- `src/server/research/http.ts` — page fetch (browser-like UA), HTML→text,
  link liveness (HEAD, GET fallback).
- `src/client/` — React UI: capture box + check-in list, polls every 8 s; a
  banner names the missing keys when research is disabled.
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

## Dependencies / Dependabot

- Dependabot majors stay enabled. The `typescript` major is ignored in
  `.github/dependabot.yml` (TypeScript 7 is outside typescript-eslint's peer
  range); lift it once typescript-eslint supports it.
- The runtime image is `node:22-alpine` and installs production dependencies
  only; `better-sqlite3` majors that change the native ABI or drop a musl
  prebuild are caught by the smoke job before merge.

## Deployment

Pi + OpenMediaVault, Compose pull from GHCR, named volume `wantlist-data`,
host port 8091. Full walkthrough (incl. GHCR login) in `docs/deployment.md`.
Dev machine has no Docker — container builds are validated by CI on GitHub
runners.