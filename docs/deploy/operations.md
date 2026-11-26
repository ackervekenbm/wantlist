# Operations

Part of the [deployment guides](README.md).

## Settings

All optional except the two keys. Leaving a setting out, or empty, keeps the
default. In Docker they go in the `.env` (or OMV's Environment box); for bare
Node in `/etc/wantlist.env`.

| Variable | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | (required) | Gemini key for the model steps |
| `SERPER_API_KEY` | (required) | Serper key for the web searches |
| `GEMINI_MODEL` | none | A Gemini model to try before the chain |
| `MODEL_CHAIN` | `gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite` | Gemini models tried in order; the next one takes over when one is out of quota |
| `GROQ_API_KEY` | none | Free fallback after Gemini (<https://console.groq.com/keys>) |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | Model used with the Groq key |
| `OPENROUTER_API_KEY` | none | Free fallback after Groq (<https://openrouter.ai/keys>) |
| `OPENROUTER_MODEL` | `google/gemma-4-31b-it:free` | Model used with the OpenRouter key |
| `WORKER_INTERVAL_MS` | `900000` (15 min) | Longest wait between research passes; new ideas and scheduled retries start one sooner |
| `WORKER_QUEUE_CAP` | `3` | Ideas researched per pass |
| `PARTNER_PROGRAMS` | none | Bill-discount programs you use, comma-separated: `viking-deals` (Mobile Vikings). Partner shops then show the price after the discount and a link that starts a tracked purchase, and hunts rank on that price. The partner list is fetched once a day; when it can't be, offers just show without it |
| `PORT` | `3000` | Port the server listens on (fixed in Docker; map the host side instead) |
| `HOST` | `0.0.0.0` | Address the server listens on |
| `DATA_DIR` | `./data` (`/app/data` in the image) | Folder that holds `wantlist.db` |

`/api/status` (and **Settings** in the app) shows the model chain in effect,
which models are benched for quota and until when, and the research queue.

## Which build is running?

**Settings → About** shows the commit and build time. A build without them
(bare Node, or an image built without the build arguments) says
"development build".

## What lives where

`wantlist.db` in the data folder is the only state: your ideas, picks,
reactions, hunts and purchases. The database runs in WAL mode, so
`wantlist.db-wal` and `-shm` sit next to it. API keys live only in the
environment, never in the database or the browser.

## Health

`GET /api/health` → `200 {"ok":true}`. The image's healthcheck polls it every
30 s.

## Backups

Stop the app, copy the data folder (all three files), start it again. On OMV a
**Services → Compose → Schedule** job with *Backup* enabled does exactly that.
Never copy the folder while the app runs: you can catch a half-written WAL
file.

## Updating

Per route: [docker-image.md](docker-image.md#updating),
[openmediavault.md](openmediavault.md#updating),
[from-source-docker.md](from-source-docker.md#updating),
[from-source-node.md](from-source-node.md#updating). The data is untouched
either way. The app shell is served with `no-cache`, so a normal refresh shows
the new build.

## Rollback

To pin a version instead of tracking `:latest`, use a commit tag,
`ghcr.io/ackervekenbm/wantlist:<sha7>`: every image published from `main` is
also tagged with its 7-character commit SHA (listed on the repo's *Packages*
page). Editing the `image:` line and starting the stack again is also how you
roll back.

Don't roll back to a version from before refine rounds: older versions replace
all picks of an idea on its next research, so earlier rounds and reactions
would be lost.

Don't roll back to a version from before Hunt either: older versions don't
know what the hunt columns mean, so hunt offers would show up as Explore picks.

## Logs

- Docker: `docker compose logs -f wantlist`
- OMV: **Services → Compose → Services** → the container → **Logs**
- Bare Node: `journalctl -u wantlist -f`
