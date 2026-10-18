# wantlist — Living Plan

**wantlist** is a private, single-user, *deferred shopping researcher*. You
type a vague buying idea in one line (e.g. *"A good fan to add to my indoor
biking setup"*) and walk away. A background worker researches it and, when you
check in later, you get 3–5 ranked picks — each with shop, price-when-seen, a
one-line reason, and a live link — Belgium-focused, in EUR, covering the whole
market (big marketplaces included, specialists surfaced too), summarized in
English.

Not a price tracker. Not a wishlist-with-links. The differentiator is the
**async research pass** plus the accumulating personal backlog of buying ideas.

**Repo**: `ackervekenbm/wantlist` (public)
**Host**: `/mnt/c/Dev/wantlist`

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Deployment | Raspberry Pi + OpenMediaVault, GHCR image pulled by Compose | Already always-on, on the LAN, €0; the async promise requires an always-on host |
| UI | React + Vite, polished dark theme | Two screens but worth doing well |
| Research depth | **No-grounding two-pass** (plan → Serper search → candidates → page reads → verify) + URL liveness check | Model can't browse on the free tier, so the app does the real searching/reading itself |
| Model | `gemini-3.8-flash` (plain generation) | Current free-tier Flash, spike-validated Oct 2026; 3.x grounding-with-search is paid-only; `gemini-3.5-flash` is the proven fallback |
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
  (`ResearchEngine`): `pipeline.ts` (plan → search → candidates → verify +
  liveness), `gemini.ts` (raw `fetch` client + prompt/schema + parsers),
  `search.ts` (Serper = zero-CAPTCHA SERP provider), `http.ts` (page fetch,
  HTML→text, link liveness).
- `src/client/` — React+Vite UI: capture box + check-in list, polled every 8 s.
- Dev: `npm run dev` runs API (`tsx watch`) + client (`vite`, proxying `/api`).

### Schema

```
ideas(id, text, status, created_at, researched_at, error)
  status: queued | researching | done | error
picks(id, idea_id, rank, title, url, price, why, source_urls, fetched_at, suppliers)
  suppliers: JSON [{shop, url, price}] - every known offer, best first; top-level
  shop/url/price mirror the best offer
```

`/api/ideas` returns full ideas with their picks; the UI needs only that one
endpoint plus `POST /api/ideas`, `DELETE /api/ideas/:id`,
`POST /api/ideas/:id/rerun`, `GET /api/status`, `POST /api/worker/run` (debug).

## Research pipeline (per idea)

Free-tier reality: `gemini-3.8-flash` generates for free but **cannot browse**
(grounding-with-search on 3.x is paid-only, verified 429 on a fresh key). So the
**engine does the searching and page-reading itself**, and the model only
reasons over evidence we hand it.

1. **Plan** (`gemini-3.8-flash`, no tools): interpret the idea →
   `{summary, criteria, searchQueries[2–4]}`. Prompts steer queries toward
   buyable product pages in Belgium, **covering the whole market**: big
   players (bol/Coolblue/Amazon) plus specialist stores and brand shops; the
   net must extend beyond the marketplaces, not stop at them.
2. **Search** (ours): each query through **Serper** (Google SERP, `gl=BE`,
   2,500 one-time free credits), organic + shopping slots, de-duped, capped at
   24 rows. No search layer → research is disabled with a clear error.
3. **Candidates** (`gemini-3.8-flash`): given the real result list, pick 3–5
   candidate **products** `{title, shop, url, price?, why}`. A candidate is a
   product, not a shop — the same product at several shops is listed once.
   Normalized hard: **URL must be one of the search results** — nothing
   invented.
4. **Verify** (`gemini-3.8-flash`): server-side fetch of the top 3 candidate
   pages, page text fed back so only evidence-backed products survive, each
   returned **once with a `suppliers` array** (every known shop offer for that
   product, best price first); the whole list is de-duplicated again at code
   level (`mergePicksByProduct`) so an identical product can never appear
   twice. Best-effort: an unfetchable page degrades to candidate evidence.
5. **Liveness**: HEAD (fallback GET) **each supplier URL**; dead suppliers are
   dropped, the best live one becomes the pick's primary link; a pick with no
   live supplier is dropped. Network failures count as unknown and are kept.

Then, and only then, the idea is `done`.

Every URL produced at steps 3–5 is validated against the allowed search-result
/ candidate URL sets — the model cannot invent fresh URLs at any stage. Each
pick = one product, with one or more buy links.

### Free-tier reality (checked Sep 2026, models re-verified Oct 2026)

- `gemini-3.8-flash`: tokens + requests free (plain generation); the default
  since Oct 2026 after two clean end-to-end spike runs. The 2.5-flash lineup is
  retired for new users — it 404s on `generateContent` even though it still
  appears in the models-list endpoint, and Google's own 404 error recommends
  3.8-flash as the successor. Grounding/search-tools are paid-only on 3.x (429
  `RESOURCE_EXHAUSTED` on a fresh key, both `v1beta` and `v1alpha`).
  `gemini-3.5-flash` remains a proven fallback (`GEMINI_MODEL=gemini-3.5-flash`)
  — it was the default until Oct 2026 because 3.6-flash was observed 503ing
  ("experiencing high demand") on heavy JSON-schema calls while 3.5 kept
  serving.
- `serper.dev`: free signup gives 2,500 one-time search credits (expire after
  6 months; 10-result queries cost 1 credit). One idea ≈ 2–4 searches → easily
  covers months of personal use; when exhausted, the `SearchProvider` interface
  makes swapping in another keyed SERP (e.g. SerpAPI 100/mo renewable) trivial.
- DuckDuckGo HTML scraping was rejected: it serves a CAPTCHA to bots.
- Google uses free-tier prompts/responses to improve models — acceptable here.
- **Concrete free-tier request limits (measured Sep 2026, fresh project):**
  `generate_content_free_tier_requests` = **20 requests/day per model** on a
  brand-new project; this is per-project and *grows as the project matures*
  (older/more-used projects get far higher ceilings). One idea = 3 Gemini
  calls → ≈ 6 ideas/day on a fresh key; expect that number to rise over
  time. Monitor real usage at **https://ai.dev/rate-limit**.
- 429/503 → exponential backoff (`BACKOFF_BASE_MS`, max 3 retries), then the
  idea is marked `error` and can be re-run from the UI.

## API keys (two–three minutes, both free)

1. **Gemini** — sign in at **https://aistudio.google.com/apikey** with any
   Google account → **Create API key** (new keys are auth keys automatically).
2. **Serper** — sign in at **https://serper.dev** (Google account) →
   free tier 2,500/mo → copy the API key.
3. Put both into `GEMINI_API_KEY` / `SERPER_API_KEY` in the Pi's compose `.env`.
   No credit card anywhere. Live limits: `aistudio.google.com/rate-limit`, `serper.dev/dashboard`.

## Phases

### Phase 0 — prove it
- [x] Scaffold repo, docs, CI, Docker packaging
- [x] `npm run build` green (typecheck + lint + vite build + server build)
- [x] `npm test` green (db + parsing/extraction unit tests)
- [ ] **Live spike**: `npm run spike "A good fan to add to my indoor biking setup"`
      against real `GEMINI_API_KEY` + `SERPER_API_KEY`; judge quality of the
      plan → search → candidates → verify output
- [ ] `npm run spike` variants: a gift idea, a niche item — check the
      whole-market mix (marketplaces + specialists) is actually working

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
| Google free-tier quotas shrink / 429s | Per-run cap (`WORKER_QUEUE_CAP`), backoff on 429, idea marked `error` + re-run; model env-configurable. Fresh projects start at 20 req/day/model and grow with maturity |
| Search layer breaks / key quota exhausted | Serper disabled → research errors visibly per idea; provider interface is pluggable (alternative keyed SERPs or Google CSE later) |
| Serper returns weak/BE-weak results | `gl=BE` set; candidate prompt covers the whole market; queries steered toward BE shops; spike-judged before v1 |
| Model hallucinates URLs | Candidates constrained to the real search-result set, verify constrained to candidate set (both validated) |
| Page fetches blocked / flaky | Best-effort with browser-like UA + timeout; unfetchable pages degrade to pass-1 evidence |
| API key leaks (public repo) | Key only ever in compose `.env`; `.env` gitignored; no key tokens in code |
| better-sqlite3 native build on arm64 | Runtime image is Debian-based `node:22-slim` (GLIBC prebuilds cover amd64 + arm64); dev machine has no Docker so CI validates |

## Costs

| Item | Cost |
|---|---|
| Gemini free tier (plain generation) | €0 |
| Serper free credits (2,500 one-time, 6-mo expiry) | €0, then swap provider via `SearchProvider` |
| GitHub (public repo + Actions + GHCR) | €0 (personal) |
| Raspberry Pi / OMV | Already owned |
| **Total** | **€0** |