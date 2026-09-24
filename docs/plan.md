# wantlist — Living Plan

**wantlist** is a private, single-user, *deferred shopping researcher*. You
type a vague buying idea in one line (e.g. *"A good fan to add to my indoor
biking setup"*) and walk away. A background worker researches it and, when you
check in later, you get 3–5 ranked picks — each with shop, price-when-seen, a
one-line reason, and a live link — Belgium-focused, in EUR, tilted toward
specialist/non-marketplace shops, summarized in English.

Not a price tracker. Not a wishlist-with-links. The differentiator is the
**async research pass** plus the accumulating personal backlog of buying ideas.

**Repo**: `ackervekenbm/wantlist` (public)
**Host**: `/mnt/c/Dev/wantlist`

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment | Raspberry Pi + OpenMediaVault, GHCR image pulled by Compose | Already always-on, on the LAN, €0; the async promise requires an always-on host |
| UI | React + Vite, polished dark theme | Two screens but worth doing well |
| Research depth | **Two-pass** Gemini grounding + URL liveness check | Quality over single-shot; still free-tier |
| Model | `gemini-2.5-flash` | Only stable Flash with grounding on the **free tier** (Gemini 3.x grounding is paid-only today) |
| Storage | SQLite (better-sqlite3), one file, named volume | Zero-ops, crash-safe, single process |
| Language | English summaries; shop/product titles as-is (nl/fr/…) | User is BE-English |
| Repo access | Public | API key lives only in compose `.env`, never in the repo |
| Monetization | None | Personal tool |

## Architecture

One npm package, no separate job service:

- `src/server/` — Express (serves `/api/*` + built client from `dist/`), the
  in-process **worker** polling the ideas queue every `WORKER_INTERVAL_MS`
  (default 15 min), better-sqlite3 in `data/wantlist.db` (`DATA_DIR`).
- `src/server/research/` — the research engine behind one interface
  (`ResearchEngine`): `pipeline.ts` (two passes + liveness), `gemini.ts`
  (raw `fetch` client + prompt/schema + parsers), `http.ts` (page fetch,
  HTML→text, link liveness).
- `src/client/` — React+Vite UI: capture box + check-in list, polled every 8 s.
- Dev: `npm run dev` runs API (`tsx watch`) + client (`vite`, proxying `/api`).

### Schema

```
ideas(id, text, status, created_at, researched_at, error)
  status: queued | researching | done | error
picks(id, idea_id, rank, title, shop, url, price, why, source_urls, fetched_at)
```

`/api/ideas` returns full ideas with their picks; the UI needs only that one
endpoint plus `POST /api/ideas`, `DELETE /api/ideas/:id`,
`POST /api/ideas/:id/rerun`, `GET /api/status`, `POST /api/worker/run` (debug).

## Research pipeline (per idea)

1. **Pass 1 — discovery** (`gemini-2.5-flash` + `google_search` grounding):
   interpret the idea, return `{summary, criteria, candidates[3–5], followUpQueries}`.
   Prompt enforces: Belgium/EUR/ships-to-BE, favor specialist & non-marketplace
   retailers, no invented URLs, ballpark prices. Normalized hard: only
   http(s) URLs kept, max 5.
2. **Pass 2 — verification**: server-side fetch of the top 3 candidate pages
   (browser-like UA), page text fed back to a second grounded call that keeps
   only evidence-backed candidates and produces the final ranked picks.
   Best-effort: an unfetchable page degrades to pass-1 evidence.
3. **Liveness**: HEAD (fallback GET) each final URL; dead links are dropped,
   network failures count as unknown and are kept.
4. Then, and only then, the idea is `done`.

Pass-2 output is validated against the allowed candidate URL set — the model
cannot invent fresh URLs at this stage.

### Free-tier reality (checked Sep 2026)

- `gemini-2.5-flash`: tokens free; grounding free up to ~500 requests/day on
  the free tier (limits are per-project, only visible in AI Studio, subject to
  change). Two passes ≈ 2–4 grounded requests per idea → >100 ideas/day headroom.
- Google uses free-tier prompts/responses to improve models — acceptable here.
- 429/503 → exponential backoff (`BACKOFF_BASE_MS`, max 3 retries), then the
  idea is marked `error` and can be re-run from the UI.

## API key (two minutes)

1. Sign in at **https://aistudio.google.com/apikey** with any Google account.
2. Click **Create API key** (new keys are auth keys automatically).
3. Copy it into `GEMINI_API_KEY` in the Pi's compose `.env`.
   No credit card, no billing. Live limits: `aistudio.google.com/rate-limit`.

## Phases

### Phase 0 — prove it
- [x] Scaffold repo, docs, CI, Docker packaging
- [x] `npm run build` green (typecheck + lint + vite build + server build)
- [x] `npm test` green (db + parsing/extraction unit tests)
- [ ] **Live spike**: `npm run spike "A good fan to add to my indoor biking setup"`
      against a real `GEMINI_API_KEY`; judge quality of the two-pass output
- [ ] `npm run spike` variants: a gift idea, a niche item — check the
      "beyond the big guys" tilt is actually working

### Phase 1 — product (done in the first build)
- [x] Server: schema, worker, API, static serving
- [x] Research engine: two-pass + liveness
- [x] Client: capture + check-in, status badges, writeup states, empty state
- [ ] Deploy on OMV via GHCR image + compose (`docs/deployment.md`), verify live
- [ ] Docker build validated locally/CI (no Docker on dev machine → CI)

### Phase 2 — later (explicitly not v1)
- [ ] Mark picked/bought, archive ideas
- [ ] "Research deeper" re-run with a higher budget
- [ ] Price/stock enrichment for final picks via bol.com/Coolblue free tiers
      (ReefAPI 1,000 credits / Parse.bot 100/mo) — optional, only if staleness
      becomes a real problem
- [ ] Configurable result language

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| Google free-tier quotas shrink / 429s | Per-run cap (`WORKER_QUEUE_CAP`), backoff on 429, idea marked `error` + re-run; model env-configurable |
| Grounding unavailable on free tier someday | Pin `gemini-2.5-flash`; model is env-configurable; fallback documented path is Serper + Groq (not wired yet) |
| Stale links / prices since research is deferred | `fetched_at` stored per pick, liveness check drops dead URLs at research time, priced picks labeled ballpark; "verify at the shop" framing in UI copy |
| Model invents URLs | Pass 2 may only reference pass-1 candidate URLs (validated); grounding sources only |
| Page fetches blocked / flaky | Best-effort with browser-like UA + timeout; unfetchable pages degrade to pass-1 evidence |
| API key leaks (public repo) | Key only ever in compose `.env`; `.env` gitignored; no key tokens in code |
| better-sqlite3 native build on arm64 | Runtime image is Debian-based `node:22-slim` (GLIBC prebuilds cover amd64 + arm64); dev machine has no Docker so CI validates |

## Costs

| Item | Cost |
|---|---|
| Gemini free tier (tokens + ~500 grounded req/day) | €0 |
| GitHub (public repo + Actions + GHCR) | €0 (personal) |
| Raspberry Pi / OMV | Already owned |
| **Total** | **€0** |