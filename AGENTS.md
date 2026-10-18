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

**Verification for every change is `npm run build && npm test`.** CI runs the
`check` job (`npm ci && npm run build && npm test`) in
`.github/workflows/docker-build.yml`, then publishes the multi-arch Docker
image to GHCR on `main`. A green `check` is required to merge.

## Issue-first workflow (MANDATORY)

Before starting any new work item, create a GitHub issue:

```bash
gh issue create --title "<what>" --body "..."   # → gives an issue number
```

- Name the branch `fix/...`, `feat/...` or `chore/...` (one per issue).
- Put `Fixes #<n>` on its own line in the PR body so the issue auto-closes on merge.
- The PR author never merges their own PR — hand over to a reviewer to merge.

## Architecture

- `src/server/index.ts` — Express bootstrap: `/api/*` + built client from
  `dist/`. Binds `0.0.0.0:3000` (`HOST`/`PORT`). Boots a deferred worker pass
  to clear queued ideas left by a restart.
- `src/server/db.ts` — better-sqlite3 in `data/wantlist.db` (`DATA_DIR`).
  Tables `ideas` (queued → researching → done/error) and `picks`.
- `src/server/worker.ts` — in-process worker: polls queued/error ideas every
  `WORKER_INTERVAL_MS` (default 15 min), processes up to `WORKER_QUEUE_CAP`
  (default 3) per run, one idea at a time. UI never blocks on live calls.
- `src/server/research/pipeline.ts` — `GeminiEngine` implements `ResearchEngine`
  with a **no-grounding** flow: plan (queries) → Serper search → candidate
  selection → fetch top pages → verify → URL-liveness filter. Gemini cannot
  browse on the free tier, so all real searching/reading happens server-side.
  429/503 → exponential backoff, then the idea is marked `error`.
- `src/server/research/gemini.ts` — raw `fetch` client for the Gemini REST API,
  prompts, JSON schemas, and the parsers presenters rely on. Pinned model
  `gemini-3.8-flash` (current free-tier Flash, spike-validated Oct 2026; 3.x
  grounding-with-search is paid-only, 2.5-flash is retired for new users, and
  3.6-flash has been seen 503ing on heavy JSON calls — `gemini-3.5-flash` is
  the proven fallback, see `docs/plan.md`).
- `src/server/research/http.ts` — page fetch (browser-like UA), HTML→text,
  link liveness (HEAD, GET fallback).
- `src/client/` — React UI: capture box + check-in list, polls every 8 s.
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

- Dependabot majors stay enabled. The `better-sqlite3` native module pins the
  runtime image to Debian-based (`node:22-slim`), so majors that change the
  native ABI must be verified by CI before merge.

## Deployment

Pi + OpenMediaVault, Compose pull from GHCR, named volume `wantlist-data`,
host port 8091. Full walkthrough (incl. GHCR login) in `docs/deployment.md`.
Dev machine has no Docker — container builds are validated by CI on GitHub
runners.