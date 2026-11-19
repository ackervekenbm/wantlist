# Models Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A read-only `#/settings` page showing which API keys are set, the model chain with each model's state, rate limits that providers report in their responses, and a dashboard link per provider.

**Architecture:** The OpenAI-compatible provider captures `x-ratelimit-*` headers; the router adds provider/model/source/last error/limits to `health()`; `/api/status` adds a key-set list. The client adds a `settings` route rendered in the right pane from the status `useIdeas` already polls.

**Tech Stack:** TypeScript, Express, React, vitest (+ supertest, Testing Library).

**Spec:** `docs/superpowers/specs/2026-11-19-models-page-design.md`

## Global Constraints

- Read-only. No settings stored, no extra API calls, no call counting. In memory, resets on restart.
- Key **values** never leave the server; only `{ name, set }`.
- Dashboard links, exactly: Gemini `https://aistudio.google.com/usage`, Groq `https://console.groq.com/settings/limits`, OpenRouter `https://openrouter.ai/activity`, Serper `https://serper.dev/dashboard`. Open in a new tab with `rel="noopener noreferrer"`.
- Client styles use `--*` tokens only, targets ≥ 44 px.
- Verify every task with `npm run build && npm test`. Branch `feat/models-page`, issue #90. Commit messages imperative, single paragraph, ending with `Fixes #90`.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A key string must never appear in `/api/status` output → Task 2 test asserts the JSON body does not contain the key value.
2. Missing or non-numeric rate-limit headers → those fields are `null`, never `NaN`; no headers at all → `limits()` stays at its previous value (null before any call) → Task 1 test.
3. A 429 response's headers still update limits (that is when OpenRouter sends them) → Task 1 test.
4. A provider whose key is not set still shows, with its link and "not set" → Task 3 test.
5. `status` still `null` (first load) → page renders a heading and no crash → Task 3 test.

---

### Task 1: Rate limits and model source on providers

**Files:**
- Modify: `src/types/index.ts` (next to `ModelHealth`)
- Modify: `src/server/research/llm.ts` (`LlmProvider`)
- Modify: `src/server/research/openai.ts`
- Modify: `src/server/research/chain.ts`
- Test: `src/server/research/openai.test.ts`, `src/server/research/chain.test.ts`

**Interfaces:**
- Produces in `src/types/index.ts`:
  ```ts
  export interface RateLimit { limit: number | null; remaining: number | null; /** Raw header: Groq "2m59.56s", OpenRouter epoch ms. */ reset: string | null }
  export interface RateLimits { requests: RateLimit | null; tokens: RateLimit | null; /** ISO-8601, when the headers were read. */ seenAt: string }
  export type ModelSource = 'default' | 'env'
  ```
- Produces on `LlmProvider` (both optional, so test fakes stay valid): `readonly modelSource?: ModelSource` and `limits?(): RateLimits | null`.
- `OpenAiCompatOptions` gains `modelSource?: ModelSource`; `OpenAiCompatProvider` exposes it and implements `limits()`.
- `GeminiProvider`: `GeminiOptions` gains `modelSource?: ModelSource`, exposed as a field; no `limits()`.

- [ ] **Step 1: Write failing tests** in `openai.test.ts`:
  - `records Groq rate-limit headers`: a 200 with `x-ratelimit-limit-requests: 1000`, `x-ratelimit-remaining-requests: 980`, `x-ratelimit-reset-requests: 2m59.56s`, `x-ratelimit-limit-tokens: 6000`, `x-ratelimit-remaining-tokens: 5400`, `x-ratelimit-reset-tokens: 6s` → `limits()` equals `{ requests: { limit: 1000, remaining: 980, reset: '2m59.56s' }, tokens: { limit: 6000, remaining: 5400, reset: '6s' }, seenAt: expect.any(String) }`.
  - `records OpenRouter's unsuffixed headers as requests, also on a 429`: a 429 with `X-RateLimit-Limit: 50`, `X-RateLimit-Remaining: 0`, `X-RateLimit-Reset: 1763596800000` → generate rejects, and `limits()` is `{ requests: { limit: 50, remaining: 0, reset: '1763596800000' }, tokens: null, ... }`.
  - `keeps limits null without headers, and nulls garbage numbers`: before any call `limits()` is `null`; a 200 with no rate-limit headers leaves it `null`; a 200 with `x-ratelimit-remaining-requests: abc` only gives `requests: { limit: null, remaining: null, reset: null }`, `tokens: null`. Rule: a group (requests/tokens) is non-null when any of its three headers is present; numbers parse with `Number`, non-finite → `null`.
  In `chain.test.ts`:
  - `marks default and env-set models`: `{ GEMINI_API_KEY: 'k' }` → every entry `modelSource: 'default'`; `{ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'x' }` → `gemini:x` is `env`, the defaults `default`; `{ GEMINI_API_KEY: 'k', MODEL_CHAIN: 'a' }` → `env`; `{ GROQ_API_KEY: 'k' }` → `default`, with `GROQ_MODEL: 'm'` → `env`; same for OpenRouter.

- [ ] **Step 2: Run** `npx vitest run src/server/research/openai.test.ts src/server/research/chain.test.ts` — expect the new tests to FAIL.

- [ ] **Step 3: Implement.** In `openai.ts` read headers right after `fetch` resolves, before the `!res.ok` branch (Headers are case-insensitive). Suffixed `-requests`/`-tokens` names first; the unsuffixed `x-ratelimit-limit/remaining/reset` fill `requests` when no suffixed request headers exist. Only replace the stored value when at least one group is non-null. In `chain.ts` pass `modelSource` per entry (Gemini: `env` when the model equals `GEMINI_MODEL` or is in the listed `MODEL_CHAIN`).

- [ ] **Step 4: Run** the same command — PASS. Then `npm run build && npm test` — PASS.

- [ ] **Step 5: Commit** `Record providers' rate-limit headers and where each model came from`.

---

### Task 2: Router health and key list in `/api/status`

**Files:**
- Modify: `src/types/index.ts` (`ModelHealth`, `ServerStatus`)
- Modify: `src/server/research/llm.ts` (`ModelRouter`)
- Modify: `src/server/research/chain.ts` (new `apiKeys`)
- Modify: `src/server/app.ts` (`AppOptions`, `/api/status`)
- Modify: `src/server/index.ts`
- Modify: `src/client/test/fakeApi.ts` (`status()` default) and any test fixture building `ModelHealth` (`grep -rn benchedUntil src`)
- Test: `src/server/research/llm.test.ts`, `src/server/research/chain.test.ts`, `src/server/app.test.ts`

**Interfaces:**
- Consumes: `RateLimits`, `ModelSource`, `LlmProvider.modelSource?`, `LlmProvider.limits?()` from Task 1.
- Produces:
  ```ts
  export interface ModelHealth {
    id: string
    /** Before the first ':' of id: 'gemini' | 'groq' | 'openrouter'. */
    provider: string
    /** After the first ':' of id. */
    model: string
    modelSource: ModelSource          // provider's value, else 'env'
    benchedUntil: string | null
    reason: 'quota' | 'unavailable' | null
    /** The last error this model returned, cut to 200 chars; cleared when it answers. */
    lastError: string | null
    limits: RateLimits | null         // provider.limits?.() ?? null
  }
  export interface ApiKeyState { name: string; set: boolean }
  // ServerStatus gains: keys: ApiKeyState[]
  ```
- `apiKeys(env: NodeJS.ProcessEnv): ApiKeyState[]` in `chain.ts`, in this order: `GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`, `SERPER_API_KEY`; `set` = non-blank after trim.
- `AppOptions` gains `keys?: ApiKeyState[]` (default `[]`); `index.ts` passes `apiKeys(process.env)`.

- [ ] **Step 1: Write failing tests.**
  - `llm.test.ts` `health reports provider, model, last error and limits`: a fake provider `{ id: 'groq:qwen/x', modelSource: 'default', limits: () => L, generate }` that first throws an `invalid` ResearchError `'groq:qwen/x: request rejected'` then answers → after the first (failing) chain call `health()[0]` has `provider: 'groq'`, `model: 'qwen/x'`, `modelSource: 'default'`, `lastError: 'groq:qwen/x: request rejected'`, `limits: L`; after a successful call `lastError` is `null`. A fake with neither optional field reports `modelSource: 'env'`, `limits: null`.
  - `chain.test.ts` `apiKeys lists the four keys without values`: `apiKeys({ GROQ_API_KEY: 'g', SERPER_API_KEY: ' ' })` → `[{name:'GEMINI_API_KEY',set:false},{name:'GROQ_API_KEY',set:true},{name:'OPENROUTER_API_KEY',set:false},{name:'SERPER_API_KEY',set:false}]`.
  - `app.test.ts` `/api/status carries key states, never values`: `createApp({ ..., keys: apiKeys({ GEMINI_API_KEY: 'secret-key-123' }) })` → `body.keys[0]` is `{ name: 'GEMINI_API_KEY', set: true }` and `res.text` does not contain `secret-key-123`.

- [ ] **Step 2: Run** `npx vitest run src/server` — new tests FAIL.

- [ ] **Step 3: Implement.** Router: a `Map<string, string>` of last errors, set in `walk`'s catch (`e.message.slice(0, 200)`), deleted on a successful answer. Update `fakeApi.status()` default model to the full `ModelHealth` shape and add `keys: []`; fix other fixtures the typecheck flags.

- [ ] **Step 4: Run** `npm run build && npm test` — PASS.

- [ ] **Step 5: Commit** `Report each model's provider, source, last error and limits, and which keys are set`.

---

### Task 3: Settings page, route, gear, docs

**Files:**
- Modify: `src/client/lib/route.ts` (+ `route.test.ts`)
- Create: `src/client/components/SettingsScreen.tsx`, `src/client/components/SettingsScreen.test.tsx`
- Modify: `src/client/components/icons.tsx` (`GearIcon`), `src/client/components/TopBar.tsx`, `src/client/App.tsx`, `src/client/styles.css` (only if `Leader`/`Section` need a small addition)
- Modify: `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: `ServerStatus.keys`, `ModelHealth` (Task 2); `clockTime` (`lib/format.ts`); `BackLink`, `Section`, `Leader`; `navigate` (`lib/route.ts`).
- Produces: `Route` gains `{ name: 'settings' }` ↔ `#/settings`; `SettingsScreen({ status }: { status: ServerStatus | null })`.

Page content (copy is the builder's, structure fixed):
- `BackLink`, `<h1 tabIndex={-1}>Settings</h1>` (same as `ListsScreen`, so `useRouteFocus` works).
- Section **Research models**: one group per provider. Group order: providers in order of first appearance in `status.models`, then any of `gemini`, `groq`, `openrouter` not in the chain. Group header: display name (`Gemini`, `Groq`, `OpenRouter`) as a link to its dashboard (Global Constraints), and `key ✓` / `not set` from `status.keys` (`GEMINI_API_KEY`, `GROQ_API_KEY`, `OPENROUTER_API_KEY`). Under it each of its models: chain position (1-based index in `status.models`), `model`, `(default)` when `modelSource === 'default'`, and state:
  - `reason === 'quota'` → `out of quota until ${clockTime(benchedUntil)}`
  - `reason === 'unavailable'` → `unavailable: ${lastError ?? 'check the model name and key'}`
  - else `ready`, plus `last error: …` (muted) when `lastError`.
  - limits, when present: requests and tokens each as `${remaining} of ${limit} requests left` / `tokens left`, with reset: an all-digit `reset` of ≥ 13 digits is epoch ms → `resets ${clockTime(...)}`, else `resets in ${reset}`. Groq/OpenRouter models with `limits === null` show `no limits reported yet`; Gemini shows nothing for limits.
- Section **Search**: `Serper` link + `key ✓` / `not set` from `SERPER_API_KEY`.
- `status === null`: heading only plus the existing `Skeleton`-free empty state (no crash).
- TopBar: a gear `<a className="iconbtn" href="#/settings" aria-label="Settings">` before the theme button, `onClick` → `preventDefault` + `navigate({ name: 'settings' })`.
- App: `route.name === 'settings'` → `<SettingsScreen status={state.status} />` in `right`.

- [ ] **Step 1: Write failing tests.**
  - `route.test.ts`: `parseHash('#/settings')` → `{ name: 'settings' }`; `toHash({ name: 'settings' })` → `'#/settings'`.
  - `SettingsScreen.test.tsx`, with `status({ models: [...], keys: [...] })` from `fakeApi`:
    - `groups models under their provider in chain order`: three Gemini models + one Groq → headings/links in order Gemini, Groq, OpenRouter; Groq row shows `(default)`.
    - `links each provider to its dashboard in a new tab`: the Gemini link has `href="https://aistudio.google.com/usage"`, `target="_blank"`, `rel` containing `noopener`; Serper link `https://serper.dev/dashboard`.
    - `shows a provider without a key`: no OpenRouter model, `OPENROUTER_API_KEY` not set → "OpenRouter" link present and "not set" in its group.
    - `shows state and limits`: a quota-benched model shows "out of quota until"; an unavailable one shows its `lastError` text; a Groq model with limits `{ requests: { limit: 1000, remaining: 980, reset: '2m59.56s' } }` shows `980 of 1000` and `2m59.56s`.
    - `renders while status is still loading`: `status={null}` → heading "Settings" present.
  - `App.test.tsx` (or `Shell.test.tsx`, following its pattern): clicking the "Settings" link in the top bar shows the "Settings" heading.

- [ ] **Step 2: Run** `npx vitest run src/client` — new tests FAIL.

- [ ] **Step 3: Implement** the route, `GearIcon` (same 24-viewBox stroke style as the other icons), `TopBar` link, `SettingsScreen`, App wiring.

- [ ] **Step 4: Docs.** README: a `<details>` section **Settings: models and keys** in user wording (what the page shows, that it's read-only, that keys and models are set in `.env`, that leaving `GROQ_MODEL`/`OPENROUTER_MODEL` blank uses a default, and that only Groq/OpenRouter report limits). AGENTS.md: `#/settings` in the route list, `SettingsScreen` in the screens list, the new `ModelHealth`/`keys` fields next to `/api/status`, and `limits()` on `OpenAiCompatProvider`. Banner unaffected.

- [ ] **Step 5: Run** `npm run build && npm test` — PASS.

- [ ] **Step 6: Commit** `Add a read-only Settings page for models and keys`.
