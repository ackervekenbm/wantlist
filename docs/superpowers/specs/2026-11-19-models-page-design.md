# Models page — design

Issue #90. Small change, approved in conversation on 2026-11-19.

## Why

The owner set `GROQ_API_KEY` and `OPENROUTER_API_KEY` without model names and
could not tell from the app whether that was enough, which models are in use,
or whether a default model name is still valid. Today the only signal is the
server log and the top-bar chip's "out of quota" tooltip.

## Goals

- A read-only page showing which API keys are set (never their values), the
  model chain in the order it is tried, and each model's current state.
- Rate limits / calls left **only where a provider's own responses report
  them**. No counting of our own calls.
- A link per provider to its usage or limits dashboard.

## Non-goals

- Editing keys, models or the chain from the app (keys stay in `.env`).
- Call counts, history, anything stored in the database: everything is in
  memory and resets on restart.
- Extra API calls to fetch quota (e.g. OpenRouter's key endpoint, Serper's
  balance).

## Approaches

- **Page at `#/settings`** (chosen): room for six-plus rows, linkable, fits
  the existing route + right-pane layout.
- Sheet from the researcher chip: cramped, not linkable. Rejected.
- Editable settings in the DB overriding env: much bigger, not wanted now.

## What each provider can show

| Provider | From its responses | Dashboard link |
|---|---|---|
| Gemini | nothing (no quota headers); only the existing quota bench ("out of quota until …") | `https://aistudio.google.com/usage` |
| Groq | `x-ratelimit-limit/remaining/reset-requests` and `-tokens` on every response | `https://console.groq.com/settings/limits` |
| OpenRouter | the same headers if it sends them (possibly only on a 429) | `https://openrouter.ai/activity` |
| Serper | key set or not | `https://serper.dev/dashboard` |

A model not called since the last restart shows "no limits reported yet".

## Design

**Server**

- `OpenAiCompatProvider` reads `x-ratelimit-*` headers on every response (ok
  or error) and keeps the latest as `RateLimits` (`requests` and `tokens`,
  each `{ limit, remaining, reset }` (reset is the raw header string) with any part null when absent;
  `seenAt`). Exposed through an optional `limits()` on `LlmProvider`; Gemini
  does not implement it.
- Each provider exposes `provider` (`gemini` / `groq` / `openrouter`) and
  `model`, and whether the model came from the default or from env
  (`GEMINI_MODEL` / `MODEL_CHAIN` / `GROQ_MODEL` / `OPENROUTER_MODEL`), set by
  `buildProviderChain`.
- `ModelRouter` remembers each entry's last error message (cleared on a
  success) and `health()` adds: `provider`, `model`, `modelSource`
  (`default` / `env`), `lastError`, `limits`.
- `ServerStatus` gains `keys: { name, set }[]` for `GEMINI_API_KEY`,
  `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `SERPER_API_KEY`. Values never leave
  the server.

**Client**

- Route `#/settings` (`{ name: 'settings' }` in `lib/route.ts`), opened from a
  gear `iconbtn` in `TopBar`. Right pane on a PC; its own screen with
  `BackLink` on a phone.
- `SettingsScreen` reads the `status` that `useIdeas` already polls. Two
  `Section`s:
  - **Research models**, grouped by provider in chain order: provider name
    with dashboard link (↗, new tab, `rel="noopener noreferrer"`), key ✓ /
    not set; under it each model with its chain position, name, "(default)"
    when applicable, and state: `ready`, `out of quota until HH:MM`,
    `unavailable: <last error>`, plus limits when known ("980 of 1000
    requests left today", "tokens left this minute").
    A provider whose key is not set still shows, with its link and "not set".
  - **Search**: Serper with link and key ✓ / not set.

**Docs**: README (the page, in user wording) and AGENTS.md (route, status
fields), same PR.

## Left to the builder

Exact copy, how reset times are formatted (`clockTime` where it is a clock
time), the gear icon drawing, test cases.
