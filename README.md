# wantlist

A single-user, **deferred shopping researcher**. Type a vague buying idea
("a good fan to add to my indoor biking setup") and walk away. A background
worker researches it — Belgium-focused, in EUR, covering the whole market including specialists —
and when you check in later you get 3–5 ranked picks with shops, ballpark
prices, reasons, and live links. Summarized in English. Costs nothing.

## Quickstart

```bash
npm install
cp .env.example .env        # add your free GEMINI_API_KEY (aistudio.google.com/apikey)
npm run dev                 # server on :3000, UI on :5173
```

`npm run spike "your idea here"` runs the two-pass research engine directly
against your key, without the UI — the fastest way to see quality.

## Build, lint, verify

```bash
npm run build     # typecheck && lint && vite build && tsc server build
npm test          # vitest unit tests (db + parsing/extraction)
```

## Architecture

- One npm package. `src/server/` — Express + better-sqlite3 + in-process worker
  (polls the queue every 15 min). `src/server/research/` — the no-grounding
  research engine behind a single `ResearchEngine` interface, with a model
  fallback chain (several Gemini models, then optional Groq/OpenRouter — all
  free tiers, no card).
  `src/client/` — React + Vite UI. `dist/` served by the server in production.
- Data: SQLite in `data/wantlist.db` (`DATA_DIR`), named volume `wantlist-data`.

## Docs

- `docs/plan.md` — full plan, research pipeline, free-tier facts, risks
- `docs/deployment.md` — Docker-on-OMV deployment