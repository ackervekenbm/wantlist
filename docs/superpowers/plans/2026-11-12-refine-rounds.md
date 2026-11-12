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
  - `reactToPick(db, pickId: number, patch: PickPatch): Idea | null` (null = unknown pick). The reason is trimmed; empty → `null`. `reaction: null` also clears the reason.
  - `class BusyError extends Error {}`. `updateIdea` throws it while `status = 'researching'` for a `preferences` patch **or a changed text**. Otherwise the running round would overwrite the fresh start. Budget and notes edits stay allowed.
  - In a patch with both `text` and `preferences`, the text is applied first, so the owner's preferences win.
  - `updateIdea` also handles:
    - `title`: a string sets `title` and `title_by_owner = 1`; `null` sets both to NULL/0.
    - `preferences`: sets `preferences` and `preferences_edited = 1`.
    - a **changed** text (compare trimmed): sets `preferences = NULL`, `preferences_edited = 0`, `fresh_since_round = round`.
  - `requeueIdea(db, id, opts: { requireSignal: boolean }): 'queued' | 'busy' | 'nothing' | null`. `null` = unknown id; `'busy'` = researching; `'nothing'` = requireSignal, no pick has a reaction and `preferences_edited = 0`. Otherwise it requeues as today (list wanted, bought NULL, attempts 0).
  - `const NOTHING_NEW = 'Nothing new found. Loosen a criterion or reword the idea.'`, added **in this task** to `src/server/research/errors.ts` (the pipeline throws it in Task 5).
  - `IDEA_COLUMNS` no longer selects `summary`/`criteria`; only the migration reads them. `title_by_owner`/`preferences_edited` are mapped to booleans explicitly, so no raw 0/1 or old columns leak into the API.

- [ ] **Step 1: Write the failing tests** in `tests/db.test.ts`:
  - `it('accumulates rounds: a second completion adds round 2 and keeps round 1')`: complete twice; `idea.round === 2`; `picks.map(p => p.round)` equals `[2, 2, 1, 1]`.
  - `it('stores the brief as title and preferences, and keeps an owner title')`: `completeIdea` with `brief: { title: 'Quiet fan', preferences: {summary:'s', mustHaves:['quiet'], avoid:[], likes:[]} }` → `title === 'Quiet fan'`; after `updateIdea(db, id, { title: 'Mine' })` plus another completion → `title === 'Mine'` and `titleByOwner === true`; `updateIdea(db,id,{title:null})` → `title === null`, `titleByOwner === false`.
  - `it('saves, changes and clears reactions with a trimmed reason')`: `reactToPick(db, pickId, { reaction: 'no', reason: '  too fluffy ' })` → `reason === 'too fluffy'`; `{ reason: '   ' }` → `reason === null`; `{ reaction: null }` → `reaction === null`; unknown pick → `null`.
  - `it('a reworded idea clears preferences and marks a fresh start; same text does not')`: after one round, `updateIdea({ text: '  ' + sameText + ' ' })` leaves `preferences` intact; `updateIdea({ text: 'winter boots' })` → `preferences === null`, `freshSinceRound === 1`.
  - `it('refuses a preferences edit or a reworded idea mid-research, but not a budget edit')`: after `claimIdea`, `updateIdea(db,id,{preferences})` and `{text:'other'}` both throw `BusyError`, while `{budget: 50}` succeeds. While queued, a preferences edit sets `preferencesEdited === true`.
  - `it('budget and notes edits keep the preferences')`.
  - `it('a failed round keeps every earlier round')`: two completions, then `failIdea` → picks of rounds 1 and 2 are still there, and `round === 2`.
  - `it('a text and preferences patch together leaves the owner preferences in place')`.
  - `it('requeue requires a signal only when asked')`: no reactions → `requeueIdea(db,id,{requireSignal:true}) === 'nothing'`, `{requireSignal:false} === 'queued'`; after a reaction on a round-1 pick → `'queued'`; while researching → `'busy'`; unknown → `null`.
  - Migration: extend `upgrades a pre-versioning database in place`, and add `it('migration 5 makes existing picks round 1 and moves the brief into preferences')`.
    - Build a **v4 DB by hand**: create the v4 tables with raw SQL and set `user_version = 4`. Don't use `openDb`, which would migrate straight to 5.
    - With `summary = 'S'`, `criteria = '["a","b"]'` and two picks: `round === 1`, `picks.every(p => p.round === 1 && p.reaction === null)`, `preferences` equals `{summary:'S', mustHaves:['a','b'], avoid:[], likes:[]}`, `title === null`.
    - A second v4 idea **with picks but NULL summary and criteria** gets `preferences` `{summary:'', mustHaves:[], avoid:[], likes:[]}`, so it is learn mode, not fresh (Review Focus 3).
  - Update the tests this task breaks:
    - `tests/pipeline.test.ts:105` (brief shape);
    - `tests/db.test.ts:105, 144, 146, 186`: `requeueIdea(db, id, {requireSignal:false})`, expecting `'queued'`/`'busy'` instead of `true`/`false`.
- [ ] **Step 2: Run** `npx vitest run tests/db.test.ts`. Expected: FAIL (new functions/fields missing).
- [ ] **Step 3: Implement.** Add migration 5 to `MIGRATIONS`, using `addColumn`:
  - picks: `round INTEGER NOT NULL DEFAULT 1`, `reaction TEXT CHECK (reaction IN ('no','maybe','yes'))`, `reason TEXT`;
  - ideas: `round INTEGER NOT NULL DEFAULT 0`, `preferences TEXT`, `preferences_edited INTEGER NOT NULL DEFAULT 0`, `title TEXT`, `title_by_owner INTEGER NOT NULL DEFAULT 0`, `fresh_since_round INTEGER`;
  - backfill: `UPDATE ideas SET round = 1 WHERE EXISTS (SELECT 1 FROM picks WHERE idea_id = ideas.id)`. **Every idea with picks** gets `preferences`, built in JS from `summary`/`criteria`, using `''`/`[]` where those are NULL.

  Map rows to the new fields (booleans from 0/1). `listIdeas`/`getIdea` order picks `round DESC, rank ASC`. Parse `preferences` defensively, like `parseRating` (bad JSON → `null`). Update the compile sites listed under **Files**:
  - pipeline: `brief: { title: '', preferences: { summary: plan.summary, mustHaves: plan.criteria, avoid: [], likes: [] } }`, until Task 5;
  - IdeaCard: show `preferences.summary` and `preferences.mustHaves` where it showed summary/criteria;
  - App filter: search `title`, `text`, `notes`, `preferences?.summary`;
  - fixtures:
    - `pick()` defaults `round: 1, reaction: null, reason: null`;
    - `idea()` defaults `round: 1, title: null, titleByOwner: false, preferencesEdited: false, freshSinceRound: null, preferences: { summary: 'A strong, quiet fan aimed at you on the trainer', mustHaves: ['airflow','noise','price'], avoid: [], likes: [] }`;
    - fakeApi's POST create overrides with `round: 0, preferences: null, title: null` (replacing `summary: null, criteria: []`);
    - `researchResult` uses the new brief shape.

    Fix the existing assertions that read `idea.summary`/`criteria`: `App.test.tsx`'s brief test reads `preferences.summary`/`mustHaves`.

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
  - `it('edits preferences within the limits, not mid-round')`: valid → 200 with `preferencesEdited === true`; 13 items → 400; a missing `likes` key → 400; after `claimIdea` → 409. A reworded `text` after `claimIdea` → 409; `{budget: 50}` after `claimIdea` → 200.
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
  - `idea.freshSinceRound !== null && idea.preferences === null` (fresh start after a reworded idea) → `{ mode: 'fresh', preferences: null, preferencesEdited: false, picks: <every pick with reaction 'no'> }`.
  - Otherwise `{ mode: 'learn', preferences, preferencesEdited, picks: <every pick with round > (freshSinceRound ?? 0), plus every 'no' pick from earlier rounds> }`.
  - `HistoryPick.urls` = `[pick.url, ...pick.suppliers.map(s => s.url)]`, de-duplicated.
- The worker passes `title: idea.title` and `history: buildHistory(idea)` in `engine.research(...)`.

- [ ] **Step 1: Write the failing tests:**
  - `tests/history.test.ts`:
    - `it('has no history before the first round')`;
    - `it('learns from every pick, with reactions and all their shop URLs')`: two rounds, reactions on both. `mode === 'learn'`, 4 picks; `urls` include the supplier URLs.
    - `it('treats an idea from before rounds as round 1 history')`: `round: 1`, reactions null → learn mode with its picks.
    - `it('a fresh start keeps only the rejected products')`: `preferences: null`, `freshSinceRound: 1`, `round: 2`, one `no` and one `yes` → `mode === 'fresh'`, picks = the `no` one only.
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
  - `describePreferences(p: Preferences): string` (lines `What it is: …`, `Must have: …`, `Avoid: …`, `Liked so far: …`; empty lists omitted).
  - `shownForPrompt(picks: HistoryPick[]): HistoryPick[]`: the 40 newest. `describeShown(shown)` numbers that capped list (`1. Title | Shop`, or `''` when empty). `repeatOf` refers to these numbers. Code-level exclusion still uses every pick.
  - `normalizePass1(raw, allowedUrls?, exclude?: (c: ResearchCandidate) => boolean)`: filters the excluded candidates **before** the `slice(0, 5)`.
  - Candidate step: `buildCandidateUser(idea, preferences: Preferences, results, shown: HistoryPick[])`. It replaces the summary/criteria lines with `describePreferences`. With a non-empty `shown`, it adds an "Already shown — never pick these again, at any shop:" block.
  - Verify step:
    - `Pass2Context` replaces `summary`/`criteria` with `preferences: Preferences; shown: HistoryPick[]` (the capped list);
    - `verifySchema(withRepeat: boolean)` replaces the `VERIFY_SCHEMA` constant. With `withRepeat`, pick items get `repeatOf: integer` ("number of the already-shown product this is the same model as, or 0");
    - the `VERIFY_SYSTEM` rule for it is added in `buildVerifyUser` **only when `shown` is non-empty**;
    - `normalizePass2(raw, allowed, shownCount: number): { picks: FinalPick[]; repeats: number }` drops and counts picks whose `repeatOf` is an integer in `1..shownCount`, and ignores the field otherwise. With `shownCount = 0` nothing is ever dropped for it.

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
  - `normalizePass2` with picks `[{…, repeatOf: 2}, {…, repeatOf: 0}]` and `shownCount: 3` → `picks.length === 1`, `repeats === 1`.
  - `it('ignores repeatOf in round 1 or out of range')`: `shownCount: 0` with `repeatOf: 1` → kept; `shownCount: 2` with `repeatOf: 5` → kept.
  - `normalizePass1` with 7 candidates, the first 3 excluded → 4 left (filtered before the cut).
  - Update the existing `normalizePass2` tests to `(raw, allowed, 0).picks`.
- [ ] **Step 2: Run** `npx vitest run tests/prompts.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** in `prompts.ts`. Adjust the pipeline's calls only enough to compile (pass `preferences` built from the plan, `shown: []`, and read `.picks`). Task 5 does the real wiring.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Prompts for titles, the learn step, preferences and repeat detection`.

### Task 5: Pipeline: learn mode, exclusion, nothing-new

**Files:**
- Modify: `src/server/research/pipeline.ts`, `src/server/research/offers.ts`, `scripts/spike.ts`
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
  3. **Search.** `searchAll(queries, progress, ex)` drops excluded hits **inside the loop**, so only new rows count toward `MAX_SEARCH_ROWS`. It returns `{ rows, excludedAny }`. If `rows` is empty and `excludedAny`, throw `NOTHING_NEW` (`no-results`) before any candidate prompt; empty without exclusions keeps today's error.
  4. **Candidates.** Parse with `normalizePass1(raw, allowed, c => isExcluded(c, ex))`. When the model named candidates but every one was excluded, record `lastParseOnlyRepeats = true` and throw `invalid`; any other parse result resets it to `false`, so the flag reflects only the **latest** model's answer. When the router finally throws `invalid` and `lastParseOnlyRepeats` is true, rethrow as `NOTHING_NEW` / `no-results`. **Never throw `no-results` inside `parse`**: the router rethrows unknown kinds at once, which would skip the rest of the chain.
  5. **Verify.** Use `shown = shownForPrompt(history?.picks ?? [])` and `normalizePass2(raw, candidates, shown.length)`, then drop `isExcluded` picks again. If no picks are left:
     - and the verify step itself dropped something (`repeats > 0`, or a pick removed by `isExcluded` here): throw `NOTHING_NEW`;
     - otherwise (the verifier just returned nothing): the existing fallback from pass 1. Those candidates are already filtered, so they are new.
  6. **Title.** The brief title is the model's title, or `request.title ?? ''` when the model's is empty.

- [ ] **Step 1: Write the failing tests** in `tests/pipeline.test.ts`. Extend `StepModel` with a `learn?` answer, recognised by `'learn step'` in the system prompt, and record `learnPrompt`. Tests:
  - `it('round 1 plans and returns a title with preferences')`: `brief.title === 'Indoor cycling fan'` (from a plan answer with that title), and `brief.preferences.mustHaves` equals the plan criteria.
  - `it('a refine learns instead of planning, and shows reasons to the model')`: history `mode:'learn'` with a `no` pick reasoned `"too loud"`. No planning prompt is sent, `learnPrompt` contains `too loud`, and the progress steps include `learning from your reactions`.
  - `it('keeps owner-edited preference items through the learn step')`.
  - `it('never repeats an earlier product: by supplier URL, by title, and by the verifier's repeatOf')`. Three cases:
    - a history pick whose **supplier** URL equals a HITS URL: dropped from the candidates;
    - a candidate with the same title at a new URL: dropped;
    - a verify answer marking one pick `repeatOf: 1`: dropped.
  - `it('stops before the candidate step when every search hit was shown before')`: history URLs cover all HITS → rejects with `{ kind: 'no-results', message: NOTHING_NEW }`, and no candidate prompt is sent.
  - `it('tries the next model, then stops with nothing new, when candidates only repeat by title')`: history titles equal the candidate titles, with different URLs. The second model is asked, and the call rejects with `{ kind: 'no-results', message: NOTHING_NEW }`.
  - `it('a model with only repeats then a model with invented URLs is retryable, not nothing-new')`: rejects with `kind: 'invalid'`.
  - `it('does not count shown hits toward the search cap')`: 24 excluded hits from the first query plus new hits from the second → the second query runs, and its products reach the candidates.
  - `it('falls back to the shortlist in a refine when the verifier returns nothing')`: round ≥ 2, verify `{picks: []}`, no repeats → the picks come from pass 1.
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
  - `IdeasActions.react(pickId: number, patch: PickPatch): Promise<void>`:
    - **optimistic** (as the design says): the pick's reaction/reason change in local state at once;
    - on failure the previous values come back and the error banner shows (via `run`);
    - only the answer to a pick's **latest** request may replace the idea (a per-pick sequence number in a ref).
  - `IdeasActions.refine(id: number): Promise<void>`: replaces the idea with the answer, then does a quiet refresh, like `rerun`.
  - **Stale polls:** a `writeSeq` ref is incremented by every write. `refresh` records it when it starts and discards its result if a write started meanwhile.
  - fakeApi:
    - handles `PATCH /api/picks/:id` **before** the `if (!found) return 404` line (the id regex only matches `/api/ideas`); it applies reaction/reason (a whitespace reason → null) and returns 404 for an unknown pick;
    - routes `POST /api/ideas/:id/(rerun|refine)` by name. Refine returns 400 when no pick has a reaction and `!preferencesEdited`, else queued;
    - PATCH applies `title`/`preferences` (and `titleByOwner`/`preferencesEdited`);
    - `isBusy` is unchanged.

  Test fixtures use pick ids that are unique across ideas.
- [ ] **Step 1: Write the failing tests** in the new `src/client/hooks/useIdeas.test.tsx` (`renderHook`; first `await waitFor(() => expect(result.current.loaded).toBe(true))`, actions inside `act`):
  - `it('saves a reaction and refines through the API')`: after `react`, `fake.writes()` contains `{method:'PATCH', path:'/api/picks/1', body:{reaction:'no', reason:'too fluffy'}}`. Then `refine(1)` → `{method:'POST', path:'/api/ideas/1/refine'}`, and the idea's `status === 'queued'`.
  - `it('shows a reaction before the server answers and rolls it back on failure')`: make the fake fail the pick PATCH once (500). The reaction shows right after the call starts, and is back to `null` after it rejects; `error` is set.
  - `it('a poll that started before a reaction does not undo it')`: delay one `GET /api/ideas` response, react meanwhile, then resolve the stale GET. The reaction is still shown.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Client calls for reactions and refine`.

### Task 7: Client UI: title, preferences, reactions, keepers, rounds, refine

**Files:**
- Create: `src/client/components/IdeaTitle.tsx`, `src/client/components/PreferencesPanel.tsx`, `src/client/components/ReactionBar.tsx`, `src/client/components/RefineBar.tsx`, `src/client/components/Keepers.tsx`, `src/client/components/EarlierRounds.tsx`, `src/client/components/IdeaCard.test.tsx`
- Modify: `src/client/components/IdeaCard.tsx`, `src/client/components/PickCard.tsx` (optional `reaction` slot), `src/client/App.tsx` (pass `react`/`refine`), `src/client/styles.css` (minimal layout with tokens)

**Interfaces:**
- Consumes: Task 6 actions; `PickPatch`, `Preferences`, limits.
- Produces. Each piece is its own small component with its own class prefix (`title-`, `prefs-`, `react-`, `keepers-`, `rounds-`, `refine-`), so the redesign can restyle it without touching IdeaCard's logic.
  - `IdeaTitle({ idea, collapsed, onToggle, bodyId, onRename(title: string | null): Promise<void> })`:
    - the collapse toggle button holds **only** the shown title (`idea.title ?? idea.text`; just `idea.text` before round 1);
    - `you asked: {idea.text}` (shown once a title exists) and a `rename` button are **siblings outside** the toggle;
    - rename swaps in a labelled input (`maxLength={TITLE_MAX}`): Enter/Save sends the trimmed text (or `null` when emptied), Escape cancels, and focus goes back to the rename button;
    - on a failed save it stays in edit mode with the typed text (catch the rethrow, as IdeaForm does);
    - the `<article>` `aria-label` becomes the shown title.
  - `PreferencesPanel({ preferences: Preferences, editable: boolean, onSave(p: Preferences): Promise<void> })`:
    - IdeaCard renders it only when `idea.preferences !== null`;
    - read view: summary plus chips (✓ must-haves, ✗ avoid, ♥ likes), with glyphs `aria-hidden`;
    - edit view: three labelled textareas, one item per line (`Must have, one per line`, `Avoid, one per line`, `Liked, one per line`), which covers add, remove and reword;
    - the draft is copied from props **only when edit is pressed**, never synced while open, so polls can't wipe it;
    - Save trims lines, drops empty ones, caps at `PREF_ITEMS_MAX`/`PREF_ITEM_CHARS`, and sends all four keys (summary unchanged);
    - a failed save keeps the editor open with the draft;
    - when `editable` is false, the edit button and Save are disabled, with **visible** text `round in progress`.
  - `ReactionBar({ title, reaction, reason, onReact(patch: PickPatch): Promise<void> })`:
    - `role="group"`, `aria-label="Your reaction to {title}"`, three toggle buttons with `aria-pressed`;
    - accessible names `No way` / `Kind of` / `Yes`, with the glyphs ✕ ~ ♥ `aria-hidden`; each target at least 44 px tall;
    - tapping the active reaction sends `{reaction: null, reason: null}`;
    - with `reaction === 'no'`, a `why not?` input labelled `Why not {title}?` (`maxLength={REASON_MAX}`) appears. Its local value is initialised from `reason`.
    - The why-not input saves `{reason}` on Enter, on blur and on unmount, but only when the value differs from the **last value sent** (kept in a ref), so Enter followed by blur sends once.
    - Focus moves into the input only right after the user taps No way.
  - `IdeaCard` layout:
    - the latest round is `idea.picks[0]?.round` (picks come newest first), so a fixture mismatch can't empty the card;
    - title, then the preferences panel;
    - **Keepers**: `yes` picks from earlier rounds as a compact one-line list (`Felt mule · round 1 · € 45 ✓ · shop link · I bought this`), not full PickCards;
    - **current round**: `<ol aria-label="Round N picks">` with a PickCard per pick and a ReactionBar slot (wanted list only);
    - **refine bar** (`RefineBar`), with N = reactions on the current round:
      - label: `Refine with 1 reaction` / `Refine with N reactions` when N > 0; `Refine with your edits` when N = 0 and `preferencesEdited`; `Refine` when N = 0 and only earlier rounds have reactions;
      - disabled when nothing anywhere has a reaction and `!preferencesEdited`, with a **visible** hint `react to a pick first` tied to it by `aria-describedby`;
      - also disabled while its request is in flight (no double POST);
      - hidden while queued/researching;
    - the queued research note gets `role="status"`;
    - **earlier rounds**: one button per round with `aria-expanded`, reading `Round k · n picks · a no · b kind of · c yes`; its picks render **only when open**, each with a ReactionBar;
    - "I bought this" stays on every pick on the wanted list, keepers and earlier rounds included;
    - the collapsed one-liner uses the current round's top pick and count;
    - the edit form's "Save & research again" calls `onRerun` as today.

  App passes `react` and `refine` through.
- [ ] **Step 1: Write the failing tests** in `IdeaCard.test.tsx`, rendering `App` with `fakeApi` as `App.test.tsx` does:
  - `it('shows the model title with the original words underneath, and renames it')`: rename, Escape cancels; rename + Enter → PATCH `{title}`; the toggle button's name is only the title.
  - `it('reacts with why-not and clears a reaction by tapping it again')`:
    - click `{name:'No way'}`, type `too fluffy` + Enter, then tab away;
    - `fake.writes()` `toEqual` exactly `[PATCH {reaction:'no'}, PATCH {reason:'too fluffy'}]`;
    - clicking `No way` again → `{reaction:null, reason:null}`.
  - `it('enables refine once there is a reaction, sends it once')`:
    - disabled, with visible `react to a pick first`;
    - after a reaction it reads `Refine with 1 reaction`;
    - a double click sends exactly one POST refine.
  - `it('pins keepers and folds earlier rounds')`: an idea at round 2, with a round-1 `yes` pick and two other round-1 picks.
    - The keepers list shows the yes pick with `round 1`.
    - The round button reads `Round 1 · 3 picks · 1 no · 1 kind of · 1 yes`, with `aria-expanded="false"`, and its picks aren't in the DOM until it is clicked.
  - `it('edits preferences, keeps the draft through a poll, and not while a round is running')`:
    - open edit and type;
    - advance a poll the way `App.test.tsx:107-120` does (fake timers, `BUSY_POLL_MS`); the draft survives;
    - with the idea `researching`, `round in progress` is visible and Save is disabled.
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
