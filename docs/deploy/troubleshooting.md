# Troubleshooting

Part of the [deployment guides](README.md). Where to find the logs:
[operations.md](operations.md#logs).

| Symptom | Fix |
|---|---|
| The container restarts with `SqliteError: unable to open database file` | The data folder can't be handed to uid 1000: it is on NTFS/exFAT/FAT, or on a read-only mount. The log line starting with `wantlist: could not give` says which folder. Move it to a Linux filesystem |
| The stack refuses to start: `set GEMINI_API_KEY in Environment` | A required key is missing from the Environment box / `.env` |
| The app says research is off | A key is missing or empty. The banner names it; `/api/status` lists `missingKeys` |
| Research errors on an idea | Temporary failures (quota, 5xx, network) retry by themselves; the card says when (15 min, doubling to 6 h, up to 5 attempts). Anything else stops with the reason on the card; *research again* requeues it |
| Every model out of quota | Expected on the free tier once the daily requests are spent. Ideas wait and resume when the first model resets (Gemini: midnight Pacific). A Groq or OpenRouter key adds capacity. Quotas per model: <https://ai.dev/rate-limit> |
| **Pull** is denied | The package was made private on GitHub. Set it back to public (Packages → wantlist → Package settings), or `docker login ghcr.io` once with a classic token that has `read:packages` |
| The page loads but every action fails | It is served under a sub-path. Give it its own host name or port ([https.md](https.md#rules-for-any-proxy)) |
