# Docker image (prebuilt)

Part of the [deployment guides](README.md).

Pull the published image: no source, no build. This is the shortest path and
the one to prefer for a home server.

```
ghcr.io/ackervekenbm/wantlist
```

## What you need

- Docker Engine or Docker Desktop
  ([install](https://docs.docker.com/engine/install/)), with the Compose v2
  plugin (`docker compose`).
- A 64-bit `amd64` or `arm64` host
  ([why](README.md#the-contract-every-route-shares)).
- The two [API keys](README.md#two-free-api-keys).
- No source, Node or login: the image is public.

## Run it with compose

Make an empty folder, e.g. `~/wantlist`, and put the repo's
[`docker-compose.yml`](../../docker-compose.yml) in it. Next to it, a `.env`
(copy [`.env.example`](../../.env.example)) with the keys:

```bash
GEMINI_API_KEY=...
SERPER_API_KEY=...
```

Then, in that folder:

```bash
docker compose up -d
curl http://localhost:8091/api/health     # {"ok":true}
```

Open <http://localhost:8091>, or `http://<server-ip>:8091` from another
device.

- The data lives in the Docker volume `wantlist-data`; updates and restarts
  keep it.
- `docker compose ps` shows `healthy` once the built-in healthcheck passes.
- Port `8091` is the host side: change the left-hand number only.
- The container log is capped at 30 MB (`logging`), so it can't fill the disk.
- The app runs as the image's unprivileged `node` user (uid 1000). The
  container starts as root only to hand `/app/data` to that user, including
  files an older image or a restore left there as root.

## Updating

```bash
docker compose pull && docker compose up -d
```

An unchanged image is a no-op; the volume is untouched either way. Pinning a
version and rolling back: [operations.md](operations.md#rollback).

## Next

- [https.md](https.md): a host name and HTTPS
- [operations.md](operations.md): settings, backups
- [troubleshooting.md](troubleshooting.md): when something doesn't work
- Back to the overview: [README.md](README.md)
