# wantlist — Deployment (Docker on OpenMediaVault)

The production host is a Raspberry Pi running **OpenMediaVault (OMV)**. The
app is published to GHCR by CI as a multi-arch image (amd64 + arm64); OMV
pulls and runs it with Docker Compose. All state (SQLite) lives in a named
volume, so every redeploy is lossless.

Prerequisite: image already published to GHCR (push to `main` triggers it,
see `.github/workflows/docker-build.yml`).

## 1. One-time host setup

- OMV with **omv-extras** installed, Docker enabled, and the **Compose**
  plugin enabled (Services → Compose).
- `DATA` is a named volume — no host path needed.
- **Ownership is automatic.** The app runs as the unprivileged user uid 1000,
  not as root. Each time the container starts it gives the data folder and the
  files in it to that user, also a volume an older image left owned by root.
  Nothing to set up in OMV and no SSH needed. A host folder used instead of the
  named volume must sit on a Linux filesystem (ext4, btrfs, xfs): NTFS, exFAT
  and FAT can't store an owner.
- **No registry login.** The image on GHCR is public, so the plugin's **Pull**
  works anonymously.

## 2. Create the compose file

In the OMV web UI (Services → Compose), create a file `wantlist.yml`:

```yaml
services:
  wantlist:
    image: ghcr.io/ackervekenbm/wantlist:latest
    container_name: wantlist
    ports:
      - "8091:3000"
    environment:
      GEMINI_API_KEY: ${GEMINI_API_KEY:?set GEMINI_API_KEY in .env}
      SERPER_API_KEY: ${SERPER_API_KEY:?set SERPER_API_KEY in .env}
      # WORKER_INTERVAL_MS: 900000
      # WORKER_QUEUE_CAP: 3
      # GEMINI_MODEL: gemini-3.8-flash
      # MODEL_CHAIN: gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite
      # GROQ_API_KEY: (optional free fallback - console.groq.com)
      # OPENROUTER_API_KEY: (optional free fallback - openrouter.ai)
    volumes:
      - wantlist-data:/app/data
    restart: unless-stopped

volumes:
  wantlist-data:
```

Create a `.env` **in the same folder** with the API keys:

```bash
GEMINI_API_KEY=AIza...your-key...
SERPER_API_KEY=...your-serper-key...
```

Keys (both free, no card):
- **Gemini**: https://aistudio.google.com/apikey
- **Serper** (search layer, 2,500 one-time free search credits): https://serper.dev

Optional fallback keys (free, no card) append to the model fallback chain when
Gemini's daily quota is spent: `GROQ_API_KEY` (https://console.groq.com/keys)
and/or `OPENROUTER_API_KEY` (https://openrouter.ai/keys).

`.env` is never committed and never appears in the repo.

## 3. Start

Save → select `wantlist.yml` → **Up**. Then open from your laptop/phone on the
LAN: **http://<pi-ip>:8091**

- The worker runs inside the container in-process (no separate service).
- First boot runs a worker pass after ~1.5 s to clear anything queued from a
  restart.

## 4. Updating after a merge

- Select the file → **Pull** → **Up** (an unchanged image is a no-op).
- The app shell is served with no-cache headers; a normal refresh picks up the
  new build. Force-refresh once if a tab looks stale.

## 5. Troubleshooting

| Symptom | Fix |
|---|---|
| **Pull** is denied (`unauthorized` / `denied`) | The package was made private on GitHub (Packages → wantlist → Package settings → visibility). Set it back to public, or log in once over SSH: `sudo docker login ghcr.io -u ackervekenbm` with a classic token that has `read:packages` |
| Container starts but ideas stay `queued` | Check both keys are set: `sudo docker exec wantlist printenv GEMINI_API_KEY SERPER_API_KEY` (non-empty). The app shows a banner naming the missing key, and the server logs a warning at boot |
| Research errors on an idea | Temporary failures (quota, 5xx, network) retry by themselves: the card says when (15 min, doubling to 6 h, up to 5 attempts). Anything else stops with the reason on the card; *research again* (`POST /api/ideas/:id/rerun`) requeues it |
| Gemini API 429 rate limits | Expected on free tier when the daily request quota is spent (fresh projects start at 20 req/day/model, grows with maturity); ideas wait in the queue and retry once a model's quota resets. Monitor: `https://ai.dev/rate-limit` |
| Logs | `sudo docker logs wantlist` |
| Query the API directly | `curl http://<pi-ip>:8091/api/health` → `{"ok":true}`; inspect state at `/api/status` and `/api/ideas` |

## Port map on this OMV

| App | Host port |
|---|---|
| vinyl-vault | 8080 |
| wantlist | 8091 |
| skin-hq | 8090 |

If 8091 is taken, change the left side of the `8091:3000` mapping and restart.