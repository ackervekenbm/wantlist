# HTTPS and a host name

Part of the [deployment guides](README.md).

Any reverse proxy works: point it at the app's port (`3000` inside the
container, e.g. `reverse_proxy wantlist:3000` in Caddy with both containers on
one Docker network; for bare Node the `PORT` you set). No headers or base-URL
setting needed.

## Rules for any proxy

- **Give it its own host name or port.** The UI calls `/api/...` from the
  root, so it can't live under a sub-path like `https://host/wantlist/`.
- **Keep the name inside your LAN or tailnet.** The app still has no login
  ([why](README.md#keep-it-on-your-lan-or-tailnet)).
- **Close the direct port.** With the proxy on the same Docker network, drop
  `ports:` from the compose file; for bare Node, set `HOST=127.0.0.1`.
