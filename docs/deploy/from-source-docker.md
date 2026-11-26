# Docker, built from a checkout

Part of the [deployment guides](README.md).

Build the image yourself from the repo, e.g. to run a version with your own
changes. It is the same image CI publishes, built on your machine.

## What you need

- Docker with the Compose v2 plugin, and `git`.
- A 64-bit `amd64` or `arm64` host
  ([why](README.md#the-contract-every-route-shares)). The build itself needs
  no compiler: nothing native is built during install.
- The two [API keys](README.md#two-free-api-keys).

## Run it

```bash
git clone https://github.com/ackervekenbm/wantlist.git
cd wantlist
cp .env.example .env          # put the keys in GEMINI_API_KEY and SERPER_API_KEY
docker build -t ghcr.io/ackervekenbm/wantlist:latest \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI) .
docker compose up -d
curl http://localhost:8091/api/health     # {"ok":true}
```

Tagging the build with the image name the compose file uses makes
`docker compose up` run your build instead of pulling. Don't run
`docker compose pull` afterwards: it would replace your build with the
published one. The build arguments are optional; they fill in
**Settings → About**.

Everything else (the `wantlist-data` volume, the healthcheck, the `node` user)
is as in [docker-image.md](docker-image.md#run-it-with-compose).

## Updating

```bash
git pull
docker build -t ghcr.io/ackervekenbm/wantlist:latest \
  --build-arg COMMIT_SHA=$(git rev-parse HEAD) \
  --build-arg BUILD_TIME=$(git log -1 --format=%cI) .
docker compose up -d
```

To roll back, `git checkout <commit>` instead of `git pull`, then build and
start the same way (but read [operations.md](operations.md#rollback) first).

## Next

- [https.md](https.md): a host name and HTTPS
- [operations.md](operations.md): settings, backups
- [troubleshooting.md](troubleshooting.md): when something doesn't work
- Back to the overview: [README.md](README.md)
