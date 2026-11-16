# Security policy

## Reporting a vulnerability

Please report security problems privately, not in a public issue:

- Use **Report a vulnerability** on the repository's **Security** tab (GitHub
  private vulnerability reporting).
- If that option isn't available, open an issue that only asks for a private
  contact, without any details of the problem.

You'll get an answer within a week. Fixes land on `main` and ship in the next
`ghcr.io/ackervekenbm/wantlist:latest` image; there are no older release lines
to patch.

## Scope and design notes

wantlist is built to run on a home network for one person. Keep that in mind
when judging impact:

- **No login.** Anyone who can reach the app can read and change the wanted
  list. It is meant for a home network; for anything reachable from outside,
  put it behind a reverse proxy with authentication and HTTPS.
- **API keys** (`GEMINI_API_KEY`, `SERPER_API_KEY` and the optional fallback
  keys) come only from the environment. They are never stored in the
  database, sent to the browser, or written to logs.
- **The server fetches web pages** found by the search step (shop pages, to
  check price and stock), with a timeout and a size cap.
- **The database** (SQLite in `/app/data`) holds ideas, picks and reactions.

Reports about exposing the app to the internet without authentication are
expected behaviour, not vulnerabilities; reports about leaked API keys, the
page fetcher being steered at hosts on the home network, or stored content
running as script in the browser are very welcome.
