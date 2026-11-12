# Quote Slip Redesign (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the client in the chosen Quote Slip design for every feature that exists today, on phone and PC (list and detail side by side from 900 px), plus the one server field the design needs (`errorKind`).

**Architecture:** The data layer (`useIdeas`, `api.ts`, server) stays. A small hash router decides the screen (phone) or the right pane (PC). New screen components (Home, Lists, Idea) replace the inline-expanding `IdeaCard` list. Behaviour-heavy pieces from the refine-rounds work (reaction save-once logic, preferences draft, title rename) are reused and restyled. The visual system is a rewrite of `styles.css` in the mockup's tokens.

**Tech Stack:** React 19, TypeScript, Vite, plain CSS tokens, Vitest + Testing Library (jsdom). Server: Express + better-sqlite3.

**Spec:** `docs/superpowers/specs/2026-11-12-quote-slip-design.md` (binding). Visual source of truth: `docs/design/quote-slip/mockup.html` and `docs/design/quote-slip/shots/`. Read both before any client task.

## Global Constraints

- Verification for every task: `npm run build && npm test`, both green at the end of every task.
- Spec decisions 1–7 under "Decisions from the builder check" are binding: the Needs you rule, `errorKind`, non-destructive Loosen and Reword, one live research line, today's preferences editing restyled, Research again kept with Try now, and today's refine rule.
- No new runtime dependency. One new **dev** dependency is allowed for the font: `@fontsource-variable/bricolage-grotesque`. It is bundled by Vite, so nothing is fetched from Google at runtime.
- Breakpoint: **900 px** (`(min-width: 900px)`). Left pane about 400 px; right pane content max about 640 px.
- Routes: `#/`, `#/idea/<id>`, `#/lists/<wanted|bought|archived>`.
- Copy as in the mockup, adjusted to the spec decisions: "What do you want?", "Needs you", "With the researcher", "Nothing new found. Loosen a criterion or reword the idea.", "Running low" is **not** in this phase.
- Colours only through `--*` tokens, in light and dark. Prices through `formatEur` (Belgian). Targets at least 44 px. `prefers-reduced-motion` honoured.
- Existing behaviours that stay tested:
  - optimistic reactions with rollback, and a stale poll never undoing a reaction;
  - the why-not reason saves once;
  - clearing a reaction clears its reason;
  - drafts (preferences, rename, why-not) survive the 5-second poll;
  - accessible names: `No way` / `Kind of` / `Yes`, `aria-pressed`, `role="group"` labels.
- Commit after each task with a message ending in `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A reload on `#/idea/<id>` for an idea that was removed or doesn't exist** shows home, not a crash or a blank pane. Pinned in Task 2.
2. **Resizing across 900 px with an idea open** keeps that idea open: in the right pane on a PC, as its own screen on a phone. Pinned in Task 2.
3. **An idea with no title yet** (first round still researching) shows the owner's words everywhere a title appears. Pinned in Task 3.
4. **A long title** (60 characters) and **long shop names** don't overflow or overlap at 390 px or in the PC's left pane. Pinned in Task 7 (visual check).
5. **The theme toggle when storage is unavailable** (private mode) still switches the theme for the session without throwing. Pinned in Task 2.

---

### Task 1: Server: failure kind on ideas

**Files:**
- Modify: `src/server/db.ts`, `src/server/worker.ts`, `src/types/index.ts`, `src/client/test/fakeApi.ts` (fixture default `errorKind: null`)
- Test: `tests/db.test.ts`, `tests/worker.test.ts`

**Interfaces:**
- Produces:
  - `type ErrorKind = 'nothing-new' | 'stopped'`;
  - `Idea.errorKind: ErrorKind | null`;
  - migration 6: `ideas.error_kind TEXT`;
  - `failIdea(db, id, message, retryAt, kind: ErrorKind | null)`: stores `kind` when `retryAt` is null and `null` when the idea will retry;
  - `completeIdea` and `requeueIdea` clear `error_kind`.
- Worker: an empty result calls `failIdea(..., null, 'nothing-new')`. In the catch, the kind is `'nothing-new'` when the error is a `ResearchError` with `kind === 'no-results'`, `null` when it will retry, and `'stopped'` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `db: it('records the failure kind and clears it on success and re-run')`.
  - `db`: migration 6 on a hand-built v5 DB (`user_version = 5`) → `errorKind === null`.
  - `worker: it('marks nothing-new for no-results and empty results, stopped for permanent errors, none while retrying')`.
- [ ] **Step 2: Run** `npx vitest run tests/db.test.ts tests/worker.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Tell nothing-new from stopped with an error kind on ideas`.

### Task 2: Foundation: tokens, font, theme, router, layout shell

**Files:**
- Create:
  - `src/client/lib/route.ts`, `src/client/lib/route.test.ts`;
  - `src/client/lib/theme.ts`, `src/client/lib/theme.test.ts`;
  - `src/client/hooks/useWide.ts`;
  - `src/client/components/Shell.tsx`, `src/client/components/Shell.test.tsx`;
  - `src/client/components/TopBar.tsx`.
- Modify: `src/client/styles.css` (rewrite base: tokens, the font, keycap `.btn`, `.chip`, `.lead` dotted leader, `.card`, `.sec-h`, `.glyph`, `.slip`, `.sheet`, `.toast`), `src/client/main.tsx` (import the font), `package.json` (dev dependency), `src/client/App.tsx` (render the Shell; the old list stays mounted as the home content until Task 3).

**Interfaces:**
- Produces:
  - **Routing:**
    - `type Route = { name: 'home' } | { name: 'idea'; id: number } | { name: 'lists'; tab: IdeaList }`;
    - `parseHash(hash: string): Route` (an unknown hash gives home);
    - `toHash(route: Route): string`;
    - `useRoute(): [Route, (r: Route) => void]` (listens to `hashchange`; navigating sets `location.hash`).
  - **Theme:**
    - `type Theme = 'system' | 'light' | 'dark'`;
    - `readTheme(): Theme` and `writeTheme(t: Theme): void` (localStorage, wrapped in try/catch);
    - `applyTheme(t: Theme): void` (sets or removes `data-theme` on `<html>`).
  - `useWide(): boolean`, via `matchMedia('(min-width: 900px)')` with a change listener.
  - **Shell:** `Shell({ left, right, route })`.
    - Wide: two panes. `left` is always shown; `right` shows the routed content, or an empty state when the route is home.
    - Narrow: shows `left` for home, otherwise `right`.
  - `TopBar({ status, theme, onTheme })`: logo, researcher chip and theme toggle, with chip states as in the spec.
  - The App resolves `#/idea/<id>` to an idea; when it doesn't exist, it navigates to `#/` (replace).

- [ ] **Step 1: Write the failing tests:**
  - `route.test`: parse and serialize round-trip for all three routes; `#/idea/abc` and `#/nope` give home.
  - `theme.test`:
    - toggling writes and applies the theme;
    - with `localStorage` throwing, `writeTheme` doesn't throw and `applyTheme` still sets `data-theme` (Review Focus 5).
  - `Shell.test`, with `matchMedia` mocked:
    - wide shows both panes and the empty state;
    - narrow on an idea route shows only the idea;
    - flipping wide to narrow keeps the idea route (Review Focus 2);
    - an unknown idea id redirects home (Review Focus 1).
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the tokens verbatim from `docs/design/quote-slip/mockup.html` (`:root` and both dark blocks).
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS (old App tests still pass, because the old list still renders inside the shell).
- [ ] **Step 5: Commit** `Quote Slip foundation: tokens, font, theme toggle, routes and the two-pane shell`.

### Task 3: Home screen

**Files:**
- Create:
  - `src/client/lib/triage.ts`, `src/client/lib/triage.test.ts`;
  - `src/client/components/HomeScreen.tsx`, `src/client/components/HomeScreen.test.tsx`;
  - `src/client/components/Leader.tsx`.
- Modify: `src/client/components/IdeaForm.tsx` (Quote Slip capture style: textarea, Add, "+ Budget & notes", "Enter adds"; keep `parseBudget` and the existing behaviour), `src/client/App.tsx` (home renders `HomeScreen`).

**Interfaces:**
- Consumes: Task 1 `errorKind`; Task 2 `Route`, Shell and TopBar.
- Produces:
  - `type Need = 'react' | 'nothing-new' | 'stopped'`;
  - `needOf(idea: Idea): Need | null`:
    - wanted list only;
    - `'react'` when the latest round has an unreacted pick and the status is done;
    - `'nothing-new'` / `'stopped'` from `status === 'error'` plus `errorKind`;
    - an error with a null `errorKind` (older rows) counts as `'stopped'`.
  - `isWorking(idea: Idea): boolean`: wanted, with status queued, researching, or queued with `nextAttemptAt`.
  - `displayTitle(idea: Idea): string`: `idea.title ?? idea.text`.
  - `HomeScreen({ ideas, status, onOpen(id), onLists(tab), onAdd })` renders:
    - capture;
    - the research-off and quota banners;
    - **Needs you** rows: glyph, title, a leader line ("React · round N …… N new picks" / "Nothing new found …… round N" / "Stopped …… try again");
    - **With the researcher** rows: a status dot, title, and a leader to the live step (`status.current.step` for the idea being researched, "queued", or "retrying around HH:MM");
    - count tiles Wanted / Bought / Archived;
    - the selected idea's row highlighted (`aria-current`) when wide.

- [ ] **Step 1: Write the failing tests:**
  - `triage.test`: each `needOf` branch, including a fully reacted round giving `null` (spec decision 1) and the legacy null `errorKind`; `displayTitle` falls back to the text (Review Focus 3).
  - `HomeScreen.test`:
    - the sections render the right ideas, with leader texts;
    - an empty Needs you shows its empty text;
    - tiles show counts and call `onLists`;
    - a row calls `onOpen`;
    - capture still adds with Enter.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** to the mockup (`shots/01-home-*`, `22`, `23`, `24`).
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS. Update `App.test.tsx` cases that relied on the old inline list to open ideas through the router.
- [ ] **Step 5: Commit** `Quote Slip home: capture, needs you, with the researcher, list tiles`.

### Task 4: Lists screen

**Files:**
- Create: `src/client/components/ListsScreen.tsx`, `src/client/components/ListsScreen.test.tsx`
- Modify: `src/client/App.tsx` (lists route)

**Interfaces:**
- Consumes: `useIdeas` (`patch`, `remove`, `undoRemove`); `Route`.
- Produces: `ListsScreen({ ideas, tab, onTab(tab), onOpen(id), onPatch, onRemove })`:
  - a back link (narrow only), the "Lists" heading, tabs with counts, and a filter when the tab has more than 8 ideas (reuse the existing `matches`);
  - rows: Wanted shows Archive; Bought and Archived show "Want again" and Remove (undo through the existing toast);
  - Bought rows read "what · where · price · when", or "Bought something else".

- [ ] **Step 1: Write the failing tests:** tab switching changes the route; the filter appears above 8 and filters; Archive / Want again / Remove send the existing API calls; a Bought row shows the snapshot.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/19`, `20`, `21`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip lists screen`.

### Task 5: Idea screen, part 1: header, status card, menu, edit

**Files:**
- Create:
  - `src/client/components/IdeaScreen.tsx`, `src/client/components/IdeaScreen.test.tsx`;
  - `src/client/components/StatusCard.tsx`;
  - `src/client/components/Sheet.tsx` (bottom sheet on a phone, centered dialog on a PC; focus trapped and returned; Escape closes).
- Modify: `src/client/components/IdeaTitle.tsx` (restyle; keep the rename behaviour and its tests), `src/client/App.tsx` (idea route renders `IdeaScreen`).

**Interfaces:**
- Consumes: `useIdeas` (`patch`, `rerun`, `remove`); `displayTitle`; Task 1 `errorKind`.
- Produces: `IdeaScreen({ idea, status, wide, onBack, actions })`. Part 1 renders:
  - **header:** a back link only when narrow; kicker "Explore · round N"; `IdeaTitle`; "You wrote “…” · notes · max € budget";
  - **overflow menu** (button + `Sheet`): Edit idea, Research again (`rerun`, hidden while researching), Bought something else, Archive, Remove. Remove and Archive navigate to `#/`;
  - **edit:** `IdeaForm` in a `Sheet` with Save and "Save & research again" (unchanged behaviour);
  - **`StatusCard`:**
    - researching: one live line with `status.current.step`, plus "Usually a few minutes; you can leave";
    - queued;
    - retrying with **Try now** (`rerun`);
    - stopped with the error text and Try again;
    - nothing new, with **Loosen a criterion** (sets a flag the preferences panel reads to open edit mode and scroll into view) and **Reword** (opens the edit sheet);
    - research off and quota.

- [ ] **Step 1: Write the failing tests:**
  - narrow shows the back link, wide doesn't;
  - each status renders its card and actions, and Try now calls `rerun`;
  - Loosen opens the preferences editor; Reword opens the edit sheet; neither changes data by itself (spec decision 3);
  - the menu actions call the right API and navigate home after Archive or Remove;
  - Research again is hidden while researching.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/02` (header), `05`, `08`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip idea screen: header, status card, menu and edit`.

### Task 6: Idea screen, part 2: the deck, refine dock, learned, keepers, rounds

**Files:**
- Create: `src/client/components/PickDeck.tsx`, `src/client/components/PickDeck.test.tsx`
- Modify:
  - `src/client/components/ReactionBar.tsx`: keycaps; keep the save-once why-not logic, now with the why-not card's quick chips (Too expensive / Not my style / Wrong type / Doubt the quality) plus own words;
  - `RefineBar.tsx`: becomes the sticky dock, with "looks disabled" plus the reason as text; today's rule (spec decision 7);
  - `PreferencesPanel.tsx`: restyled; today's edit model (spec decision 5); honours the Loosen flag;
  - `Keepers.tsx`, `EarlierRounds.tsx`: restyled; still reactable;
  - `PickCard.tsx`: becomes the deck card (real `pick.image`, with the placeholder when missing or broken);
  - `IdeaScreen.tsx`.

**Interfaces:**
- Consumes: `useIdeas.react`, `refine`; existing components.
- Produces: `PickDeck({ idea, onReact, onBought })`:
  - **What it shows:** the latest round, one card at a time. Pips have `aria-current` and jump to a pick. The card shows a photo (or placeholder), rank, a stamp for the reaction, title, price with ✓ checked or ≈ search price, shop, why, the "Check:" caveat, other shops, "I bought this" and "Open shop".
  - **Moving through picks:** after Yes or Kind of it moves to the next unreacted pick, about 250 ms with motion and immediately with reduced motion. No way stays and shows the why-not card. Tapping the active reaction clears it.
  - **Gestures and keys:** swipe left or right on the card mirrors No way / Yes (horizontal only, at least 90 px, `touch-action: pan-y`). The arrow keys move between picks while the card has focus.
  - **End of round:** after the last pick it shows "Round N sorted" with the tally, and Refine and "Look again".

- [ ] **Step 1: Write the failing tests** (port and extend `IdeaCard.test.tsx` and `PickCard.test.tsx`; the old files are deleted in Task 7):
  - `PickDeck.test`:
    - Yes advances to the next unreacted pick (fake timers);
    - No way stays and shows why-not, and its reason saves once on Enter then blur (exact `writes()` list);
    - tapping the active reaction sends `{reaction:null, reason:null}`;
    - pips jump;
    - a pointer drag of 120 px right sends Yes, and a mostly vertical drag sends nothing;
    - a missing image shows the placeholder.
  - `IdeaScreen.test` (part 2):
    - the refine dock is disabled with its reason as visible text, and enabled after a reaction;
    - the preferences draft survives a poll;
    - keepers and earlier rounds render and stay reactable.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/02`, `03`, `04`, `06`, `07`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip idea screen: the deck, refine dock, what I've learned, keepers and rounds`.

### Task 7: Remove the old UI, then the visual check

**Files:**
- Delete: `src/client/components/IdeaCard.tsx`, `IdeaCard.test.tsx`, `StatusBadge.tsx`, `PickCard.test.tsx` (once its cases live in `PickDeck.test.tsx`), and unused CSS.
- Modify: `src/client/App.tsx`, `src/client/App.test.tsx` (app-level flows through the router: add → appears in With the researcher; open → react → refine; remove → undo; theme toggle).

- [ ] **Step 1:** Delete the old components. Port any behaviour test still missing to the new files (grep the deleted tests' `it(` names and check each has a new home).
- [ ] **Step 2: Run** `npm run build && npm test`. Expected: PASS, with no leftover imports and lint clean.
- [ ] **Step 3: Visual check** (process step, not committed). Using `~/tools/playwright` (see the memory note), drive the built app (`npm run build`, then `node dist-server/server/index.js` with `DATA_DIR` in a temp dir, seeded through the API) or the Vite dev server against the fake data. Screenshot at **390×844** and **1440×900**, light and dark:
  - home;
  - home with a long title (60 characters) and a long shop name (Review Focus 4);
  - idea with picks;
  - why-not open;
  - researching;
  - nothing new;
  - lists (Bought);
  - the edit sheet;
  - the PC with nothing selected.

  Compare against `docs/design/quote-slip/shots/`. Fix anything clipped, overlapping, misaligned, too loud or off-system, and screenshot again until clean. Save the final shots under the plan's workspace and list them in the report.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Remove the old card UI; visual fixes from the screenshot check`.

### Task 8: Docs

**Files:**
- Modify: `AGENTS.md` (client architecture: router, shell, screens, theme, font, triage; the server `errorKind`), `README.md` (what it looks like; works on phone and PC).

- [ ] **Step 1:** Update the docs to match the code.
- [ ] **Step 2: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `Document the Quote Slip client`.
