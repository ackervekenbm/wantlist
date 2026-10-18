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

## 2. GHCR login (one-time per host)

GHCR requires a login even for public images. Over SSH:

```bash
sudo docker login ghcr.io -u ackervekenbm
```

The password is a GitHub **classic** personal access token (fine-grained
tokens don't support GitHub Packages):

1. https://github.com/settings/tokens → *Tokens (classic)* → **Generate new token**
2. Tick **`read:packages`** (add `repo` too if you `git pull` on the Pi with the same token)
3. Expiry ≤ 1 year; re-login when it lapses.

## 3. Create the compose file

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
2. **Serper** (search layer, 2,500 one-time free search credits): https://serper.dev

`.env` is never committed and never appears in the repo.

## 4. Start

Save → select `wantlist.yml` → **Up**. Then open from your laptop/phone on the
LAN: **http://<pi-ip>:8091**

- The worker runs inside the container in-process (no separate service).
- First boot runs a worker pass after ~1.5 s to clear anything queued from a
  restart.

## 5. Updating after a merge

- Select the file → **Pull** → **Up** (an unchanged image is a no-op).
- The app shell is served with no-cache headers; a normal refresh picks up the
  new build. Force-refresh once if a tab looks stale.

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| **Pull** fails with an auth error | Re-run the GHCR login from step 2, then Pull → Up again |
| Container starts but ideas stay `queued` | Check both keys are set: `sudo docker exec wantlist printenv GEMINI_API_KEY SERPER_API_KEY` (non-empty). The server logs a warning at boot when either is missing |
| Research errors on an idea | The card shows the reason; `POST /api/ideas/:id/rerun` (or the *research again* button) requeues it |
| Gemnn/API 429 rate limits | Expected on free tier when the daily request quota is spent (fresh projects start at 20 req/day/model, grows with maturity); ideas go to `error` with the rate-limit message, re-run later. Monitor: `https://ai.dev/rate-limit` |
| Logs | `sudo docker logs wantlist` |
| Query the API directly | `curl http://<pi-ip>:8091/api/health` → `{"ok":true}`; inspect state at `/api/status` and `/api/ideas` |

## Port map on this OMV

| App | Host port |
|---|---|
| vinyl-vault | 8080 |
| wantlist | 8091 |
| skin-hq | 8090 |

If 8091 is taken, change the left side of the `8091:3000` mapping and restart.