# wantlist — Deployment

wantlist is one container: the web UI, the API and the research worker in a
single node process, with its state in one SQLite file. CI publishes it as
`ghcr.io/ackervekenbm/wantlist:latest` for `amd64` and `arm64`. The image is
public, so pulling it needs no login.

What every route shares:

- **Any always-on 64-bit Docker host.** Research runs in the background, so the
  host must stay on. The reference deployment is **OpenMediaVault** with its
  Compose plugin; [plain Docker Compose](#plain-docker-compose) works the same.
- **Two free API keys**, no card needed: Gemini
  (<https://aistudio.google.com/apikey>) for the model and Serper
  (<https://serper.dev>, 2,500 one-time search credits) for search. Without
  them the app runs but research stays off, and it says so.
- **Container port `3000`**, data in **`/app/data`**. Only the host side of
  both is yours to choose.
- **No login in the app.** Keep it on your LAN or tailnet; never forward a
  port to it from the internet.

## OpenMediaVault (Compose plugin)

Prerequisites: omv-extras with the **`openmediavault-compose`** plugin, and
the plugin's *Compose Files* and *Data* shared folders set in **Services →
Compose → Settings**.

1. **Services → Compose → Files → Create** (`+`).
2. **Name**: `wantlist` (a stack name, not a filename).
3. **File**: paste

   ```yaml
   services:
     wantlist:
       image: ghcr.io/ackervekenbm/wantlist:latest
       ports:
         - "8091:3000"
       environment:
         GEMINI_API_KEY: ${GEMINI_API_KEY:?set GEMINI_API_KEY in Environment}
         SERPER_API_KEY: ${SERPER_API_KEY:?set SERPER_API_KEY in Environment}
         # Optional: blank uses the app's default (table below).
         GEMINI_MODEL: ${GEMINI_MODEL:-}
         MODEL_CHAIN: ${MODEL_CHAIN:-}
         GROQ_API_KEY: ${GROQ_API_KEY:-}
         GROQ_MODEL: ${GROQ_MODEL:-}
         OPENROUTER_API_KEY: ${OPENROUTER_API_KEY:-}
         OPENROUTER_MODEL: ${OPENROUTER_MODEL:-}
         WORKER_INTERVAL_MS: ${WORKER_INTERVAL_MS:-}
         WORKER_QUEUE_CAP: ${WORKER_QUEUE_CAP:-}
       volumes:
         - CHANGE_TO_COMPOSE_DATA_PATH/wantlist-data:/app/data
       logging:
         driver: json-file
         options:
           max-size: "10m"
           max-file: "3"
       restart: unless-stopped
   ```

4. **Environment**: the two keys, one per line, no quotes. Add any optional
   setting from the [table](#settings) only to change it.

   ```bash
   GEMINI_API_KEY=...
   SERPER_API_KEY=...
   ```

5. **Save**, select the entry, **Up**. Open `http://<server-ip>:8091`.

Verify: **Services → Compose → Services** shows the container running (and
healthy after half a minute), and `http://<server-ip>:8091/api/health`
returns `{"ok":true}`.

What the file does:

- **`CHANGE_TO_COMPOSE_DATA_PATH/wantlist-data`**: the plugin fills in the
  *Data* shared folder's path, so `<Data folder>/wantlist-data/wantlist.db` is
  the whole server-side state: an ordinary folder you can browse, copy and back
  up, which **Prune → Volume** can't delete.
- **Ownership is automatic.** The app runs as the unprivileged user uid 1000.
  Each time the container starts it gives `wantlist-data` and the files in it
  to that user, also a folder an older image or a restore left owned by root.
  Nothing to set up and no SSH needed. The folder must sit on a Linux
  filesystem (ext4, btrfs, xfs, what OMV formats with): NTFS, exFAT and FAT
  can't store an owner, and the app then can't open its database.
- **Port `8091`**: any free host port works; change the left-hand number only.
  Behind a [reverse proxy](#https--reverse-proxy) on the same Docker network
  you can drop `ports:` altogether.
- **No `container_name`**: compose names it `wantlist-wantlist-1`.
- **`logging`**: caps the container log at 30 MB, so it can't fill the disk.
- **The settings are listed, not commented out.** Compose only passes a value
  from the Environment box into the container when the file names it.

## Plain Docker Compose

The repo's [`docker-compose.yml`](../docker-compose.yml) is the same stack with
a named volume (`wantlist-data`) instead of the OMV folder. Next to it, a
`.env` with the keys (copy [`.env.example`](../.env.example)), then:

```bash
docker compose up -d
curl http://localhost:8091/api/health     # {"ok":true}
```

## Settings

All optional except the two keys. Leaving a setting out, or empty, keeps the
default.

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

`/api/status` shows the model chain in effect, which models are benched for
quota and until when, and the research queue.

## Updating

OMV: select the stack → **Pull** → **Up**. Plain compose:
`docker compose pull && docker compose up -d`. An unchanged image is a no-op;
the data folder is untouched either way. The app shell is served with
`no-cache`, so a normal refresh shows the new build.

To pin a version instead of tracking `:latest`, use a commit tag,
`ghcr.io/ackervekenbm/wantlist:<sha7>`: every image published from `main` is
also tagged with its 7-character commit SHA (listed on the repo's *Packages*
page). Editing that line and pressing **Up** is also how you roll back.

Don't roll back to an image from before refine rounds: older images replace
all picks of an idea on its next research, so earlier rounds and reactions
would be lost.

## Backups

`wantlist.db` in the data folder is the only state (the database runs in WAL
mode, so `wantlist.db-wal` and `-shm` sit next to it). Stop the container,
copy the folder, start it again; on OMV, a **Services → Compose → Schedule**
job with *Backup* enabled does exactly that. Never copy the folder while the
container runs: you can catch a half-written WAL file.

## HTTPS / reverse proxy

Any reverse proxy works: point it at the container's port `3000` (e.g.
`reverse_proxy wantlist:3000` in Caddy with both containers on one Docker
network). Give it its own host name: the UI calls `/api/...` from the root,
so it can't live under a sub-path. No headers or base-URL setting needed. It
still has no login, so keep the proxied name inside your LAN.

## Troubleshooting

| Symptom | Fix |
|---|---|
| The container restarts with `SqliteError: unable to open database file` | The data folder can't be handed to uid 1000: it is on NTFS/exFAT/FAT, or on a read-only mount. The log line starting with `wantlist: could not give` says which folder. Move it to a Linux filesystem |
| The stack refuses to start: `set GEMINI_API_KEY in Environment` | A required key is missing from the Environment box / `.env` |
| The app says research is off | A key is missing or empty. The banner names it; `/api/status` lists `missingKeys` |
| Research errors on an idea | Temporary failures (quota, 5xx, network) retry by themselves; the card says when (15 min, doubling to 6 h, up to 5 attempts). Anything else stops with the reason on the card; *research again* requeues it |
| Every model out of quota | Expected on the free tier once the daily requests are spent. Ideas wait and resume when the first model resets (Gemini: midnight Pacific). A Groq or OpenRouter key adds capacity. Quotas per model: <https://ai.dev/rate-limit> |
| **Pull** is denied | The package was made private on GitHub. Set it back to public (Packages → wantlist → Package settings), or `docker login ghcr.io` once with a classic token that has `read:packages` |
| Logs | OMV: **Services → Compose → Services** → the container → **Logs**. Plain: `docker compose logs wantlist` |
