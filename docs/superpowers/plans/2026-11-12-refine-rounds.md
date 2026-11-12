# Refine Rounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** React to picks (no / maybe / yes + why-not), learn preferences from the reactions, and research new rounds in the background without ever repeating a product. The card gets a model-written title.

**Architecture:** Picks accumulate per `round`. The research request carries a `history` built from the idea. Round ≥ 2 replaces the plan step with a learn step, which outputs a title, preferences and queries. Earlier products are excluded in code (every supplier URL, normalized title) and by a verify-step `repeatOf` flag. The client gets reaction buttons, a preferences panel, a title editor, keepers, collapsed earlier rounds and a refine button.

**Tech Stack:** TypeScript, Express 5, better-sqlite3, React 19, Vitest (+ Testing Library / jsdom for the client).

**Spec:** `docs/superpowers/specs/2026-11-12-refine-rounds-design.md` (read it before any task).

## Global Constraints

- Verification for every task: `npm run build && npm test`. Both must be green at the end of every task (the build typechecks, lints and builds).
- Migrations are append-only (`MIGRATIONS` in `src/server/db.ts`). Migration 5 must work on a fresh DB, a v4 DB and a pre-versioning DB.
- Limits, in the new `src/types/limits.ts`: `TITLE_MAX = 60`, `REASON_MAX = 300`, `PREF_ITEMS_MAX = 12`, `PREF_ITEM_CHARS = 120`, `PREF_SUMMARY_CHARS = 300`.
- Reactions are `'no' | 'maybe' | 'yes'`. UI labels: `✕ No way`, `~ Kind of`, `♥ Yes`.
- "Nothing new" failure message, verbatim: `Nothing new found. Loosen a criterion or reword the idea.`, with kind `no-results`.
- Learn-step progress step, verbatim: `learning from your reactions`.
- The model never browses. Every pick URL must come from search results (unchanged rules).
- Tests never touch the network (existing harnesses: `tests/pipeline.test.ts` StepModel, `tests/helpers.ts`, `src/client/test/fakeApi.ts`).
- Client styles use the `--*` tokens in `styles.css`, never hard-coded colors. Visual polish is out of scope; the redesign follows separately.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A reason that is only whitespace** is stored as `null`, and a reason longer than `REASON_MAX` gets a 400. Pinned in Task 2.
2. **Saving the same idea text again** (only surrounding whitespace differs) must not reset the preferences. Pinned in Task 1.
3. **An idea researched before this change** (picks with no round, no reactions) shows as round 1 and can be refined, with history built from those picks. Pinned in Tasks 1 and 3.
4. **Refining a bought or archived idea** moves it back to `wanted` and clears `bought`, like re-run does. Pinned in Task 2.
5. **Reacting to a pick from an older round** saves, counts as a signal for refine, and its product stays excluded. Pinned in Tasks 2 and 5.

---

### Task 1: Data model, migration 5, rounds and reactions in the DB

**Files:**
- Create: `src/types/limits.ts`
- Modify: `src/types/index.ts`, `src/server/db.ts`, `src/server/research/pipeline.ts` (brief shape only), `scripts/spike.ts` (print), `src/client/components/IdeaCard.tsx` (brief → preferences display, minimal), `src/client/App.tsx:198` (filter uses `title`/`preferences.summary`), `src/client/test/fakeApi.ts` (fixture defaults), `tests/helpers.ts`
- Test: `tests/db.test.ts`

**Interfaces:**
- Produces (types, `src/types/index.ts`):
  - `type Reaction = 'no' | 'maybe' | 'yes'`
  - `interface Preferences { summary: string; mustHaves: string[]; avoid: string[]; likes: string[] }`
  - `Pick` adds `round: number; reaction: Reaction | null; reason: string | null`
  - `Idea` **removes** `summary`, `criteria`, and adds `title: string | null; titleByOwner: boolean; round: number; preferences: Preferences | null; preferencesEdited: boolean; freshSinceRound: number | null`. `Idea.picks` is ordered by round DESC, then rank ASC.
  - `ResearchBrief` becomes `{ title: string; preferences: Preferences }`
  - `interface HistoryPick { round: number; title: string; shop: string | null; price: number | null; why: string | null; reaction: Reaction | null; reason: string | null; urls: string[] }` (`urls`: `url` plus every supplier URL)
  - `interface ResearchHistory { mode: 'learn' | 'fresh'; preferences: Preferences | null; preferencesEdited: boolean; picks: HistoryPick[] }`
  - `ResearchRequest` adds `title?: string | null; history?: ResearchHistory | null`
  - `IdeaPatch` adds `title?: string | null; preferences?: Preferences`
  - `interface PickPatch { reaction?: Reaction | null; reason?: string | null }`
- Produces (db, `src/server/db.ts`):
  - `completeIdea(db, id, result, now?)`: inserts picks with `round = idea.round + 1` **without deleting** earlier picks, sets `round`, `preferences` (JSON), `preferences_edited = 0`, and `title` unless `title_by_owner = 1` (an empty model title keeps the old one). Returns `boolean` as today.
  - `reactToPick(db, pickId: number, patch: PickPatch): Idea | null` (null = unknown pick). The reason is trimmed; empty → `null`.
  - `class BusyError extends Error {}`. `updateIdea` throws it for a `preferences` patch while `status = 'researching'`.
  - `updateIdea` also handles:
    - `title`: a string sets `title` and `title_by_owner = 1`; `null` sets both to NULL/0.
    - `preferences`: sets `preferences` and `preferences_edited = 1`.
    - a **changed** text (compare trimmed): sets `preferences = NULL`, `preferences_edited = 0`, `fresh_since_round = round`.
  - `requeueIdea(db, id, opts: { requireSignal: boolean }): 'queued' | 'busy' | 'nothing' | null`. `null` = unknown id; `'busy'` = researching; `'nothing'` = requireSignal, no pick has a reaction and `preferences_edited = 0`. Otherwise it requeues as today (list wanted, bought NULL, attempts 0).
  - `const NOTHING_NEW = 'Nothing new found. Loosen a criterion or reword the idea.'` (exported from `src/server/research/errors.ts`; the pipeline throws it in Task 5).

- [ ] **Step 1: Write the failing tests** in `tests/db.test.ts`:
  - `it('accumulates rounds: a second completion adds round 2 and keeps round 1')`: complete twice; `idea.round === 2`; `picks.map(p => p.round)` equals `[2, 2, 1, 1]`.
  - `it('stores the brief as title and preferences, and keeps an owner title')`: `completeIdea` with `brief: { title: 'Quiet fan', preferences: {summary:'s', mustHaves:['quiet'], avoid:[], likes:[]} }` → `title === 'Quiet fan'`; after `updateIdea(db, id, { title: 'Mine' })` plus another completion → `title === 'Mine'` and `titleByOwner === true`; `updateIdea(db,id,{title:null})` → `title === null`, `titleByOwner === false`.
  - `it('saves, changes and clears reactions with a trimmed reason')`: `reactToPick(db, pickId, { reaction: 'no', reason: '  too fluffy ' })` → `reason === 'too fluffy'`; `{ reason: '   ' }` → `reason === null`; `{ reaction: null }` → `reaction === null`; unknown pick → `null`.
  - `it('a reworded idea clears preferences and marks a fresh start; same text does not')`: after one round, `updateIdea({ text: '  ' + sameText + ' ' })` leaves `preferences` intact; `updateIdea({ text: 'winter boots' })` → `preferences === null`, `freshSinceRound === 1`.
  - `it('refuses a preferences edit mid-research')`: `claimIdea` then `updateIdea(db,id,{preferences})` throws `BusyError`; while queued it sets `preferencesEdited === true`.
  - `it('requeue requires a signal only when asked')`: no reactions → `requeueIdea(db,id,{requireSignal:true}) === 'nothing'`, `{requireSignal:false} === 'queued'`; after a reaction on a round-1 pick → `'queued'`; while researching → `'busy'`; unknown → `null`.
  - Migration (extend `upgrades a pre-versioning database in place`, add `it('migration 5 makes existing picks round 1 and moves the brief into preferences')`): a v4 DB (`user_version = 4`) with `summary = 'S'`, `criteria = '["a","b"]'` and two picks → `round === 1`, `picks.every(p => p.round === 1 && p.reaction === null)`, `preferences` equals `{summary:'S', mustHaves:['a','b'], avoid:[], likes:[]}`, `title === null`.
- [ ] **Step 2: Run** `npx vitest run tests/db.test.ts`. Expected: FAIL (new functions/fields missing).
- [ ] **Step 3: Implement.** Add migration 5 to `MIGRATIONS`, using `addColumn`:
  - picks: `round INTEGER NOT NULL DEFAULT 1`, `reaction TEXT CHECK (reaction IN ('no','maybe','yes'))`, `reason TEXT`;
  - ideas: `round INTEGER NOT NULL DEFAULT 0`, `preferences TEXT`, `preferences_edited INTEGER NOT NULL DEFAULT 0`, `title TEXT`, `title_by_owner INTEGER NOT NULL DEFAULT 0`, `fresh_since_round INTEGER`;
  - backfill: `UPDATE ideas SET round = 1 WHERE EXISTS (SELECT 1 FROM picks WHERE idea_id = ideas.id)`, and `preferences` built in JS from `summary`/`criteria` where `summary IS NOT NULL OR criteria IS NOT NULL`.

  Map rows to the new fields (booleans from 0/1). `listIdeas`/`getIdea` order picks `round DESC, rank ASC`. Parse `preferences` defensively, like `parseRating` (bad JSON → `null`). Update the compile sites listed under **Files**:
  - pipeline: `brief: { title: '', preferences: { summary: plan.summary, mustHaves: plan.criteria, avoid: [], likes: [] } }`, until Task 5;
  - IdeaCard: show `preferences.summary` and `preferences.mustHaves` where it showed summary/criteria;
  - App filter: search `title`, `text`, `notes`, `preferences?.summary`;
  - fixtures: new defaults (`round: 1`, `reaction: null`, `reason: null`, `title: null`, `titleByOwner: false`, `preferences: null`, `preferencesEdited: false`, `freshSinceRound: null`) and `researchResult` with the new brief shape. Fix the existing assertions that read `idea.summary`/`criteria`.

  `app.ts` keeps compiling by mapping `requeueIdea(...) !== 'queued'` to the 409 until Task 2.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Store rounds, reactions, preferences and titles (migration 5)`.

### Task 2: API: reactions, title, preferences, refine

**Files:**
- Modify: `src/server/app.ts`
- Test: `tests/app.test.ts`

**Interfaces:**
- Consumes: Task 1's `reactToPick`, `updateIdea` (+ `BusyError`, `PatchError`), `requeueIdea(…,{requireSignal})`, limits.
- Produces:
  - `PATCH /api/picks/:id` → 200 Idea | 400 | 404.
  - `PATCH /api/ideas/:id` also takes `title` (string 1..`TITLE_MAX` after trim, or null) and `preferences` (`summary` string ≤ `PREF_SUMMARY_CHARS`; three arrays of ≤ `PREF_ITEMS_MAX` non-empty strings ≤ `PREF_ITEM_CHARS` after trim; all four keys required). `BusyError` → 409 `{ error: 'a round is in progress' }`.
  - `POST /api/ideas/:id/refine` → 202 Idea, 400 `{error:'react to a pick or edit the preferences first'}`, 409, 404. Kicks the worker on 202.
  - `POST /api/ideas/:id/rerun` → `requeueIdea(…,{requireSignal:false})`, otherwise unchanged.

- [ ] **Step 1: Write the failing tests** in `tests/app.test.ts`, using the existing supertest setup:
  - `it('reacts to a pick with a reason, and validates it')`: 200 with `picks[i].reaction === 'no'`; `{reaction:'love'}` → 400; reason of `REASON_MAX + 1` chars → 400; `{reason: '   '}` → stored `null`; unknown pick → 404; `PATCH /api/picks/abc` → 400.
  - `it('renames and un-names an idea')`: `{title:'x'.repeat(61)}` → 400; `{title:'  '}` → 400; `{title:'Mine'}` → 200 with `titleByOwner === true`; `{title:null}` → `titleByOwner === false`.
  - `it('edits preferences within the limits, not mid-round')`: valid → 200 with `preferencesEdited === true`; 13 items → 400; a missing `likes` key → 400; after `claimIdea` → 409.
  - `it('refines only with something to learn from')`: 400 without reactions; 202 after a reaction, with `worker.kick` called; 409 while researching; 404 unknown.
  - `it('refining a bought idea puts it back on the wanted list')`: list bought + a reaction → refine → `list === 'wanted'`, `bought === null`.
  - `it('rerun needs no reactions')` → 202.
- [ ] **Step 2: Run** `npx vitest run tests/app.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes and `parsePickPatch(body): PickPatch | string`, `parseTitle(raw): string | null | {error}`, `parsePreferences(raw): Preferences | {error}`, in the file's existing validation style. Reaction PATCH with neither key → 400 `nothing to change`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `API for reactions, titles, preferences and refine`.

### Task 3: History builder and worker hand-off

**Files:**
- Create: `src/server/history.ts`
- Modify: `src/server/worker.ts`
- Test: `tests/history.test.ts` (new), `tests/worker.test.ts`

**Interfaces:**
- Consumes: `Idea`, `ResearchHistory`, `HistoryPick` (Task 1).
- Produces: `buildHistory(idea: Idea): ResearchHistory | null`:
  - `idea.round === 0` → `null`.
  - `idea.preferences === null` (fresh start after a reworded idea) → `{ mode: 'fresh', preferences: null, preferencesEdited: false, picks: <every pick with reaction 'no'> }`.
  - Otherwise `{ mode: 'learn', preferences, preferencesEdited, picks: <every pick with round > (freshSinceRound ?? 0), plus every 'no' pick from earlier rounds> }`.
  - `HistoryPick.urls` = `[pick.url, ...pick.suppliers.map(s => s.url)]`, de-duplicated.
- The worker passes `title: idea.title` and `history: buildHistory(idea)` in `engine.research(...)`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/history.test.ts`:
    - `it('has no history before the first round')`;
    - `it('learns from every pick, with reactions and all their shop URLs')`: two rounds, reactions on both. `mode === 'learn'`, 4 picks; `urls` include the supplier URLs.
    - `it('treats an idea from before rounds as round 1 history')`: `round: 1`, reactions null → learn mode with its picks.
    - `it('a fresh start keeps only the rejected products')`: `preferences: null`, `round: 2`, one `no` and one `yes` → `mode === 'fresh'`, picks = the `no` one only.
    - `it('after a fresh start, learns only from later rounds plus earlier rejects')`: `freshSinceRound: 1`, `round: 2`, round-1 picks `[no, yes]`, round-2 picks `[maybe]` → picks = round-1 `no` + round-2 `maybe`.
  - `tests/worker.test.ts`: `it('hands the title and history to the engine')`: complete once, react `no`, requeue, run → `engine.calls[1].history?.mode === 'learn'`, and `engine.calls[1].history?.picks.find(p => p.reaction === 'no')` exists; `engine.calls[0].history === null`.
- [ ] **Step 2: Run** `npx vitest run tests/history.test.ts tests/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `buildHistory` and the two extra fields in `worker.ts`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Build research history from earlier rounds and hand it to the engine`.

### Task 4: Prompts: plan title, learn step, preferences, shown list, repeatOf

**Files:**
- Modify: `src/server/research/prompts.ts`
- Test: `tests/prompts.test.ts`

**Interfaces:**
- Consumes: `Preferences`, `ResearchHistory`, `HistoryPick`, limits.
- Produces:
  - Plan step:
    - `ResearchPlan` adds `title: string`;
    - `QUERY_SCHEMA` adds a required `title` ("Short, specific name for what is being looked for, ≤ 60 chars, English");
    - `QUERY_SYSTEM` gets one rule line for it;
    - `normalizePlan` trims the title and caps it at `TITLE_MAX`.
  - `capPreferences(raw: unknown): Preferences`: coerces and trims; drops empty items; truncates to the limits (it never throws).
  - `keepOwnerItems(learned: Preferences, owner: Preferences): Preferences`: every owner item present in its list (exact string), owner items first, then the caps.
  - Learn step:
    - `LEARN_SYSTEM` (its first line contains `learn step`, so the test StepModel can recognise it);
    - `LEARN_SCHEMA` (required `title`, `preferences{summary,mustHaves,avoid,likes}`, `searchQueries`);
    - `buildLearnUser(idea: IdeaInput, title: string | null, history: ResearchHistory): string`;
    - `normalizeLearn(raw: unknown): { title: string; preferences: Preferences; searchQueries: string[] }`. Queries are capped at 4; zero queries → `ResearchError` kind `invalid` (same as `normalizePlan`).
  - `describePreferences(p: Preferences): string` (lines `What it is: …`, `Must have: …`, `Avoid: …`, `Liked so far: …`; empty lists omitted) and `describeShown(picks: HistoryPick[]): string` (numbered `1. Title | Shop`, or `''` when empty).
  - Candidate step: `buildCandidateUser(idea, preferences: Preferences, results, shown: HistoryPick[])`. It replaces the summary/criteria lines with `describePreferences`. With a non-empty `shown`, it adds an "Already shown — never pick these again, at any shop:" block.
  - Verify step:
    - `Pass2Context` replaces `summary`/`criteria` with `preferences: Preferences; shown: HistoryPick[]`;
    - `VERIFY_SCHEMA` pick items get `repeatOf: integer` ("number of the already-shown product this is the same model as, or 0");
    - `VERIFY_SYSTEM` gets a rule for it;
    - `normalizePass2(raw, allowed): { picks: FinalPick[]; repeats: number }` drops picks with `repeatOf ≥ 1` and counts them.

  `LEARN_SYSTEM` must state:
  - keep criteria that still hold;
  - turn every reason into a concrete `avoid` (or `mustHave`) item;
  - turn `yes`/`maybe` picks into `likes`, as traits, never product names;
  - items marked as the owner's must stay word-for-word;
  - a sharper title only when the reactions justify one;
  - 1–4 English queries aimed at what's missing, phrased so they don't resurface rejected products;
  - Belgium / EUR, and the budget rule (`BUDGET_RULE`).

  `buildLearnUser`:
  - includes `describeIdea`, the current title, and the current preferences (headed "set by the owner — keep every item" when `preferencesEdited`);
  - lists at most the 40 newest history picks, one line each: `round N · Title | Shop | EUR price · reaction: no — "reason"`, or `· no reaction`.

- [ ] **Step 1: Write the failing tests** in `tests/prompts.test.ts`:
  - `normalizePlan` returns a capped `title` (61 chars in → 60 out).
  - `capPreferences({summary: 5, mustHaves: [' a ', '', 'x'.repeat(200)], avoid: 'nope'})` → `{summary:'5', mustHaves:['a','x'.repeat(120)], avoid:[], likes:[]}`; 20 items → 12.
  - `keepOwnerItems` keeps an owner `avoid` item the model dropped.
  - `buildLearnUser` contains `reaction: no — "too fluffy"`, the "set by the owner" heading when edited, and at most 40 history lines for 50 picks.
  - `normalizeLearn` with no queries throws `ResearchError` with `kind === 'invalid'`.
  - `buildCandidateUser` with a shown pick contains `Already shown` and that title; without one it doesn't.
  - `normalizePass2` with picks `[{…, repeatOf: 2}, {…, repeatOf: 0}]` → `picks.length === 1`, `repeats === 1`. Update the existing `normalizePass2` tests to `.picks`.
- [ ] **Step 2: Run** `npx vitest run tests/prompts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `prompts.ts`. Adjust the pipeline's calls only enough to compile (pass `preferences` built from the plan, `shown: []`, and read `.picks`). Task 5 does the real wiring.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Prompts for titles, the learn step, preferences and repeat detection`.

### Task 5: Pipeline: learn mode, exclusion, nothing-new

**Files:**
- Modify: `src/server/research/pipeline.ts`, `src/server/research/offers.ts`, `src/server/research/errors.ts` (`NOTHING_NEW` if not added in Task 1), `scripts/spike.ts`
- Test: `tests/pipeline.test.ts`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces:
  - In `offers.ts`: `interface Exclusion { urls: Set<string>; titles: Set<string> }`, `exclusionOf(picks: HistoryPick[]): Exclusion` (normalized), and `isExcluded(item: { title: string; url: string; suppliers?: { url: string }[] }, ex: Exclusion): boolean`.
  - `PipelineEngine.research` returns `brief: { title, preferences }`.

  Flow:
  1. **Exclusion set.** `ex = exclusionOf(history?.picks ?? [])`.
  2. **Plan or learn.**
     - `history?.mode === 'learn'`: call `step('learning from your reactions')`. Run the learn step, and when `history.preferencesEdited`, apply `keepOwnerItems(learned.preferences, history.preferences)`.
     - Otherwise run the plan step (fresh or round 1). Its preferences are `{summary, mustHaves: criteria, avoid: [], likes: []}` and its title is the plan's.
  3. **Search.** Run the queries as today. Search rows whose URL is excluded are dropped before the candidate step. If nothing is left and something was excluded, throw `NOTHING_NEW` (`no-results`).
  4. **Candidates.** Parse with `normalizePass1` + `isExcluded` filtering. If candidates existed but all were excluded, set `sawOnlyRepeats = true` and throw `invalid`. When the router finally throws `invalid` and `sawOnlyRepeats` is set, rethrow as `NOTHING_NEW` / `no-results`.
  5. **Verify.** Use `shown = history?.picks ?? []` and drop `isExcluded` picks again. If no picks are left:
     - and `repeats > 0` or something was excluded: throw `NOTHING_NEW`;
     - otherwise: the existing fallback from pass 1, also filtered by `isExcluded`.
  6. **Title.** The brief title is the model's title, or `request.title ?? ''` when the model's is empty.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline.test.ts`. Extend `StepModel` with a `learn?` answer, recognised by `'learn step'` in the system prompt, and record `learnPrompt`. Tests:
  - `it('round 1 plans and returns a title with preferences')`: `brief.title === 'Indoor cycling fan'` (from a plan answer with that title), and `brief.preferences.mustHaves` equals the plan criteria.
  - `it('a refine learns instead of planning, and shows reasons to the model')`: history `mode:'learn'` with a `no` pick reasoned `"too loud"`. No planning prompt is sent, `learnPrompt` contains `too loud`, and the progress steps include `learning from your reactions`.
  - `it('keeps owner-edited preference items through the learn step')`.
  - `it('never repeats an earlier product: by supplier URL, by title, and by the verifier's repeatOf')`. Three cases:
    - a history pick whose **supplier** URL equals a HITS URL: dropped from the candidates;
    - a candidate with the same title at a new URL: dropped;
    - a verify answer marking one pick `repeatOf: 1`: dropped.
  - `it('stops with nothing new when only earlier products are found')`: every candidate excluded, across two models. `rejects.toMatchObject({ kind: 'no-results', message: NOTHING_NEW })`.
  - `it('a fresh start plans again but still excludes rejected products')`: `mode:'fresh'`. The planning prompt is used, and a `no` pick's URL is never in the picks.
  - `it('excludes a reacted pick from an older round')` (Review Focus 5): history from round 1 with reaction `maybe` → not in the picks.
  - Update the existing `brief` assertion (`tests/pipeline.test.ts:105`) to the new shape.
- [ ] **Step 2: Run** `npx vitest run tests/pipeline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the flow above. `spike.ts` prints `title`, `preferences` and picks.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Refine rounds in the pipeline: learn step, exclusion and nothing-new`.

### Task 6: Client data: API calls, hook actions, fake API

**Files:**
- Modify: `src/client/api.ts`, `src/client/hooks/useIdeas.ts`, `src/client/test/fakeApi.ts`
- Test: `src/client/App.test.tsx` (hook through the UI comes in Task 7). Here: add `src/client/hooks/useIdeas.test.tsx` only if the existing tests don't already drive the hook directly; otherwise extend `App.test.tsx`.

**Interfaces:**
- Produces:
  - `api.patchPick(id: number, patch: PickPatch): Promise<Idea>`, `api.refineIdea(id: number): Promise<Idea>`;
  - `IdeasActions.react(pickId: number, patch: PickPatch): Promise<void>`, `IdeasActions.refine(id: number): Promise<void>` (both replace the idea with the server's answer; refine also triggers a quiet refresh, like `rerun`);
  - fakeApi:
    - handles `PATCH /api/picks/:id` (applies reaction/reason; 404 unknown);
    - handles `POST /api/ideas/:id/refine` (400 when no pick has a reaction and `!preferencesEdited`, else queued);
    - PATCH applies `title`/`preferences` (and `titleByOwner`/`preferencesEdited`);
    - `isBusy` is unchanged.
- [ ] **Step 1: Write the failing test**: `it('saves a reaction and refines through the API')` drives `useIdeas` via `renderHook`. After `react`, `fake.writes()` contains `{method:'PATCH', path:'/api/picks/1', body:{reaction:'no', reason:'too fluffy'}}`. Then `refine(1)` → `{method:'POST', path:'/api/ideas/1/refine'}`, and the idea's `status === 'queued'`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Client calls for reactions and refine`.

### Task 7: Client UI: title, preferences, reactions, keepers, rounds, refine

**Files:**
- Create: `src/client/components/IdeaTitle.tsx`, `src/client/components/PreferencesPanel.tsx`, `src/client/components/ReactionBar.tsx`, `src/client/components/IdeaCard.test.tsx`
- Modify: `src/client/components/IdeaCard.tsx`, `src/client/components/PickCard.tsx` (optional `reaction` slot), `src/client/App.tsx` (pass `react`/`refine`), `src/client/styles.css` (minimal layout with tokens)

**Interfaces:**
- Consumes: Task 6 actions; `PickPatch`, `Preferences`, limits.
- Produces:
  - `IdeaTitle({ idea, onRename(title: string | null): Promise<void> })`:
    - before the first round it shows `idea.text` as the heading;
    - after it, it shows `idea.title ?? idea.text` with `you asked: {idea.text}` underneath;
    - a "rename" button opens an input (`maxLength={TITLE_MAX}`) whose save sends the trimmed text, or `null` when cleared.
  - `PreferencesPanel({ preferences, editable: boolean, onSave(p: Preferences): Promise<void> })`:
    - shows the summary and chips: ✓ must-haves, ✗ avoid, ♥ likes;
    - "edit" opens three chip lists with add/remove (inputs capped by the limits) and Save/Cancel;
    - when `editable` is false (researching), the edit button is disabled with title `round in progress`.
  - `ReactionBar({ reaction, reason, onReact(patch: PickPatch): Promise<void> })`:
    - three toggle buttons with `aria-pressed`, labels per Global Constraints; tapping the active one sends `{reaction:null}`;
    - after `no`, a one-line `why not?` input (`maxLength={REASON_MAX}`), pre-filled with `reason`, which saves `{reason}` on blur/Enter when changed.
  - `IdeaCard` layout:
    - title, then the preferences panel;
    - **Keepers**: `yes` picks from rounds before the latest, labelled `round N`;
    - the **current round** (`round === idea.round`) with a `ReactionBar` per pick (wanted list only);
    - **refine button**: `Refine with N reactions`, where N counts reactions on the current round. It is disabled with the hint `react to a pick first` when N is 0, no pick at all has a reaction and `!preferencesEdited`. It is hidden while queued/researching;
    - **earlier rounds** as `<details>`, summary `Round k · n picks · a no · b kind of · c yes`. Their picks still have a ReactionBar;
    - the collapsed one-liner uses the current round's top pick;
    - the edit form's "Save & research again" calls `onRerun` as today.

  App passes `react` and `refine` through.
- [ ] **Step 1: Write the failing tests** in `IdeaCard.test.tsx`, rendering `App` with `fakeApi` as `App.test.tsx` does:
  - `it('shows the model title with the original words underneath, and renames it')`.
  - `it('reacts with why-not and clears a reaction by tapping it again')`: click `✕ No way`, type `too fluffy` + Enter → writes include the reaction and the reason; click again → `{reaction:null}`.
  - `it('enables refine once there is a reaction and sends it')`: disabled with `react to a pick first`; after a reaction it reads `Refine with 1 reaction`, and clicking it → POST refine.
  - `it('pins keepers and folds earlier rounds')`: an idea with `round: 2`, a round-1 `yes` pick and two round-1 others. Keepers show the yes pick with `round 1`; the `<details>` summary reads `Round 1 · 3 picks · 1 no · 1 kind of · 1 yes`.
  - `it('edits preferences, but not while a round is running')`.
  - Update `App.test.tsx`'s "shows the brief" test to the preferences panel.
- [ ] **Step 2: Run** `npx vitest run src/client`. Expected: FAIL.
- [ ] **Step 3: Implement** the components. Keep the styles minimal and token-based.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Refine UI: titles, preferences, reactions, keepers and rounds`.

### Task 8: Docs and whole-branch check

**Files:**
- Modify: `AGENTS.md` (Architecture bullets: db rounds/reactions/preferences/title + migration 5; pipeline learn step + exclusion + `no-results`; the new routes; client components), `README.md` ("What it can do": react, why-not, refine rounds, titles)

- [ ] **Step 1:** Update the docs to match the code (no new behaviour).
- [ ] **Step 2: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `Document refine rounds`.
