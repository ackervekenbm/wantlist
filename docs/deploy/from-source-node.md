# Bare Node (from a checkout)

Part of the [deployment guides](README.md).

Run the built server directly under Node, with systemd keeping it alive. Use
this when the host already runs Node and you'd rather not add Docker.

## What you need

- **Node 22 or newer** and `git`. Check with `node -v`; if your distribution's
  Node is older, install a current LTS from
  [NodeSource](https://github.com/nodesource/distributions).
- **A 64-bit OS**: `node -p process.arch` must print `x64` or `arm64`
  ([why](README.md#the-contract-every-route-shares)).
- No C compiler, Python or `make`: the repo's `.npmrc` turns install scripts
  off and the SQLite library ships its binary.
- The two [API keys](README.md#two-free-api-keys).

## Install as a service

The checkout lives in `/opt/wantlist`, the database in `/var/lib/wantlist`,
and a system user `wantlist` owns both.

**1. Create the service user:**

```bash
sudo useradd --system --user-group --create-home --home-dir /var/cache/wantlist \
  --shell /usr/sbin/nologin wantlist
sudo install -d -o wantlist -g wantlist /opt/wantlist
```

**2. Clone and build as that user** (`-H` keeps npm's cache in its home):

```bash
sudo -u wantlist -H git clone https://github.com/ackervekenbm/wantlist.git /opt/wantlist
sudo -u wantlist -H bash -c 'cd /opt/wantlist && npm ci && npm run build'
```

**3. Store the keys** where only root can read them; systemd passes them on:

```bash
sudo install -m 600 /dev/null /etc/wantlist.env
sudo tee /etc/wantlist.env >/dev/null <<'EOF'
GEMINI_API_KEY=...
SERPER_API_KEY=...
EOF
```

Add any other [setting](operations.md#settings) to that file, one per line.

**4. Write the unit:**

```bash
sudo tee /etc/systemd/system/wantlist.service >/dev/null <<'EOF'
[Unit]
Description=wantlist (deferred shopping researcher)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=wantlist
Group=wantlist
# The server serves dist/ from its working directory.
WorkingDirectory=/opt/wantlist
Environment=NODE_ENV=production
Environment=PORT=8091
Environment=DATA_DIR=/var/lib/wantlist
EnvironmentFile=/etc/wantlist.env
# Creates /var/lib/wantlist for User=, readable by it only.
StateDirectory=wantlist
StateDirectoryMode=0700
ExecStart=/usr/bin/node dist-server/server/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable --now wantlist
```

Check: `curl http://127.0.0.1:8091/api/health` → `{"ok":true}`, then open
`http://<server-ip>:8091`.

The server listens on every interface (`HOST=0.0.0.0`), like the container.
Behind a [reverse proxy](https.md) on the same machine, add
`Environment=HOST=127.0.0.1` so only the proxy reaches it.

## Updating

```bash
sudo -u wantlist -H bash -c 'cd /opt/wantlist && git pull && npm ci && npm run build'
sudo systemctl restart wantlist
```

To roll back, `git checkout <commit>` instead of `git pull`, then build and
restart the same way (but read [operations.md](operations.md#rollback) first).

## Logs

`journalctl -u wantlist -f`.

## Next

- [https.md](https.md): a host name and HTTPS
- [operations.md](operations.md): settings, backups
- [troubleshooting.md](troubleshooting.md): when something doesn't work
- Back to the overview: [README.md](README.md)
