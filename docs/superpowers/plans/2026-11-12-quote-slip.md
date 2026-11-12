# Quote Slip Redesign (phase 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the client in the chosen Quote Slip design for every feature that exists today, on phone and PC (list and detail side by side from 900 px), plus the one server field the design needs (`errorKind`).

**Architecture:** The data layer (`useIdeas`, `api.ts`, server) stays. A small hash router decides the route; both panes are always rendered and CSS decides which shows below 900 px. New screen components (Home, Lists, Idea) replace the inline-expanding `IdeaCard` list. Behaviour-heavy pieces from the refine-rounds work (reaction save-once logic, preferences draft, title rename) are reused and restyled. The visual system is a rewrite of `styles.css` in the mockup's tokens.

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
2. **Resizing across 900 px with an idea open** keeps that idea open: in the right pane on a PC, as its own screen on a phone. Holds by construction (both panes always rendered, CSS picks); checked in Task 7 screenshots.
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
  - Migration 6 also backfills existing `status = 'error'` rows: `'nothing-new'` when `error` starts with `No product survived` or `Nothing new found`, else `'stopped'`.
  - Wiring: `error_kind AS errorKind` in `IDEA_COLUMNS`, `errorKind` on `IdeaRow`. The client reads `errorKind` only when `status === 'error'`.
  - `kind` is a required fifth argument; update the existing 4-argument `failIdea` calls in `tests/db.test.ts` and `tests/app.test.ts`.
- Worker: an empty result calls `failIdea(..., null, 'nothing-new')`. In the catch, the kind is `'nothing-new'` when the error is a `ResearchError` with `kind === 'no-results'`, `null` when it will retry, and `'stopped'` otherwise.

- [ ] **Step 1: Write the failing tests:**
  - `db: it('records the failure kind and clears it on success and re-run')`.
  - `db`: migration 6 on a hand-built v5 DB (`user_version = 5`) with three rows: a done idea → `errorKind === null`; an error "No product survived verification…" → `'nothing-new'`; an error "Serper key refused" → `'stopped'`.
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
  - `src/client/components/Shell.tsx`, `src/client/components/Shell.test.tsx`;
  - `src/client/components/TopBar.tsx`.
- Modify:
  - `src/client/styles.css`: rewrite the base (tokens, the font, keycap `.btn`, `.chip`, `.lead` dotted leader, `.card`, `.sec-h`, `.glyph`, `.slip`, `.sheet`, `.toast`). Keep the old component classes working until Task 7.
  - `src/client/main.tsx`: import the font, and call `applyTheme(readTheme())` before `render` so the theme doesn't flash.
  - `package.json`: the dev dependency.
  - `src/client/App.tsx`: render the Shell. The old page stays as the left pane's content until Task 3.

**Interfaces:**
- Produces:
  - **Routing:**
    - `type Route = { name: 'home' } | { name: 'idea'; id: number } | { name: 'lists'; tab: IdeaList }`;
    - `parseHash(hash: string): Route` (an unknown hash gives home);
    - `toHash(route: Route): string`;
    - `useRoute(): [Route, (r: Route, opts?: { replace?: boolean }) => void]`. It listens to `hashchange`. Navigating sets `location.hash`. With `replace` it uses `history.replaceState` and then updates its state itself, because `replaceState` fires no `hashchange`.
  - **Theme:**
    - `type Theme = 'system' | 'light' | 'dark'`;
    - `readTheme(): Theme` and `writeTheme(t: Theme): void` (localStorage, each wrapped in try/catch);
    - `applyTheme(t: Theme): void` (sets or removes `data-theme` on `<html>`).
  - **Shell:** `Shell({ route, left, right, banner, toast })`.
    - Renders `<div class="shell" data-route={route.name}>`, with **both panes always in the DOM**. Which one shows is pure CSS; there is no width hook:
      - below 900 px, `[data-route=home] .pane-right` and `:not([data-route=home]) .pane-left` are hidden, and the document scrolls;
      - from 900 px, both panes show, each `height: 100dvh; overflow: auto`. On the home route, the right pane shows the empty state "Pick an idea on the left, or add one" with the quote-slip mark.
    - Renders `banner` (the existing error banner: `role=alert`, dismiss) and `toast` (the undo toast) once, outside both panes.
  - **TopBar:** `TopBar({ status, theme, onTheme })`: logo, researcher chip (idle / researching with the title / N queued / out of quota until … / research off), and the theme toggle (system → light → dark, with an accessible name naming the current theme).
  - **App routing:**
    - The App resolves `#/idea/<id>`.
    - **Only once `state.loaded` is true** and the id is missing does it `navigate({name:'home'}, {replace:true})`.
    - Before that, the right pane shows the existing loading skeleton.
  - **Focus and scroll on route change:**
    - Opening an idea or the lists moves focus to that screen's `h1` (`tabIndex=-1`) and scrolls to the top: the window below 900 px, the right pane's `scrollTop` from 900 px.
    - Going back to home restores focus to the row with that idea's `data-idea-id`, when it is present.

- [ ] **Step 1: Write the failing tests:**
  - `route.test`:
    - parse and serialize round-trip for all three routes;
    - `#/idea/abc` and `#/nope` give home;
    - `navigate(r, {replace:true})` updates the route without adding a history entry (`history.length` unchanged).
  - `theme.test`:
    - toggling writes and applies the theme;
    - with `localStorage` throwing, `readTheme` returns `'system'`, `writeTheme` doesn't throw, and `applyTheme` still sets `data-theme` (Review Focus 5).
  - `Shell.test`:
    - both panes render on every route;
    - `data-route` follows the route;
    - the empty state shows on home.

    (Which pane is visible at which width is CSS; Review Focus 2 holds by construction and is checked in Task 7's screenshots.)
  - `App.test`:
    - a reload on `#/idea/<existing id>` stays on that idea after the first load (Review Focus 1, positive case);
    - `#/idea/999` goes to `#/` once loaded, with no extra history entry (Review Focus 1).
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Copy the tokens verbatim from `docs/design/quote-slip/mockup.html` (`:root` and both dark blocks).
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS. The old App tests still pass, because the old page renders in the left pane.
- [ ] **Step 5: Commit** `Quote Slip foundation: tokens, font, theme toggle, routes and the two-pane shell`.

### Task 3: Home screen

**Files:**
- Create:
  - `src/client/lib/triage.ts`, `src/client/lib/triage.test.ts`;
  - `src/client/lib/filter.ts`: `matches` moved out of `App.tsx`;
  - `src/client/components/HomeScreen.tsx`, `src/client/components/HomeScreen.test.tsx`;
  - `src/client/components/Leader.tsx`;
  - `src/client/components/IdeaForm.test.tsx`: the `parseBudget` tests move here from `PickCard.test.tsx`.
- Modify:
  - `src/client/components/IdeaForm.tsx`: Quote Slip capture style (textarea, Add, "+ Budget & notes", "Enter adds"); keep `parseBudget` and the existing behaviour.
  - `src/client/App.tsx`. **Stop-gap until Tasks 4 and 5:**
    - home renders `HomeScreen`;
    - the idea route renders the old `IdeaCard` for that idea (forced open) in the right pane;
    - the lists route renders the old tabbed list, moved verbatim into `src/client/components/OldLists.tsx`.
  - `src/client/App.test.tsx`: cases that relied on the single page now reach ideas through the hash routes.

**Interfaces:**
- Consumes: Task 1 `errorKind`; Task 2 `Route`, `navigate`, Shell and TopBar.
- Produces:
  - `type Need = 'react' | 'nothing-new' | 'stopped'`;
  - `needOf(idea: Idea): Need | null`:
    - wanted list only;
    - `'react'` when the status is done and the latest round has an unreacted pick;
    - `'nothing-new'` / `'stopped'` when `status === 'error'`, from `errorKind`;
    - a null `errorKind` on an error counts as `'stopped'`.
  - `isWorking(idea: Idea): boolean`: wanted, with status `queued` or `researching`, including queued with `nextAttemptAt`.
  - Titles: reuse the existing `shownTitle` from `IdeaTitle.tsx` (no new helper).
  - `matches(idea: Idea, query: string): boolean` in `lib/filter.ts`.
  - `HomeScreen({ ideas, status, selectedId, onOpen(id), onLists(tab), onAdd })` renders:
    - capture;
    - the research-off and quota banners;
    - **Needs you** rows: glyph, title, a leader line ("React · round N …… N new picks" / "Nothing new found …… round N" / "Stopped …… try again");
    - **With the researcher** rows: a status dot, title, and a leader to the live step (`status.current.step` for the idea being researched, "queued", or "retrying around HH:MM" via `clockTime`);
    - count tiles Wanted / Bought / Archived;
    - rows that are buttons with `data-idea-id`, with `aria-current="true"` on the selected idea;
    - with **zero ideas**, the welcome in Quote Slip style (keep the existing welcome test).

- [ ] **Step 1: Write the failing tests:**
  - `triage.test`:
    - each `needOf` branch, including a fully reacted round giving `null` (spec decision 1) and the null `errorKind`;
    - `shownTitle` falls back to the text while the first round is researching (Review Focus 3).
  - `HomeScreen.test`:
    - the sections render the right ideas, with leader texts;
    - an empty Needs you shows its empty text;
    - tiles show counts and call `onLists`;
    - a row calls `onOpen`;
    - the selected row has `aria-current`;
    - capture still adds with Enter;
    - the zero-ideas welcome.
  - `IdeaForm.test`: the moved `parseBudget` cases.
- [ ] **Step 2: Run** the new tests. Expected: FAIL.
- [ ] **Step 3: Implement** to the mockup (`shots/01-home-*`, `22`, `23`, `24`).
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip home: capture, needs you, with the researcher, list tiles`.

### Task 4: Lists screen

**Files:**
- Create: `src/client/components/ListsScreen.tsx`, `src/client/components/ListsScreen.test.tsx`
- Modify: `src/client/App.tsx` (the lists route renders `ListsScreen`)
- Delete: `src/client/components/OldLists.tsx`

**Interfaces:**
- Consumes: `useIdeas` (`patch`, `remove`); `Route`; `matches` from `lib/filter.ts`.
- Produces: `ListsScreen({ ideas, tab, onTab(tab), onOpen(id), onPatch, onRemove })`:
  - a back link (CSS hides it from 900 px), the "Lists" `h1`, tabs with counts, and a filter when the tab has more than 8 ideas;
  - rows: Wanted shows Archive; Bought and Archived show "Want again" and Remove (undo through the Shell's toast);
  - Bought rows read "what · where · price · when", or "Bought something else".

- [ ] **Step 1: Write the failing tests:**
  - tab switching changes the route;
  - the filter appears above 8 and filters, with "Nothing matches that filter.";
  - Archive / Want again / Remove send the existing API calls;
  - a Bought row shows the snapshot.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/19`, `20`, `21`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip lists screen`.

### Task 5: Idea screen, part 1: header, status card, menu, edit

**Files:**
- Create:
  - `src/client/components/IdeaScreen.tsx`, `src/client/components/IdeaScreen.test.tsx`;
  - `src/client/components/StatusCard.tsx`;
  - `src/client/components/Sheet.tsx`;
  - `src/client/components/PickList.tsx`: temporary; renders the latest round's picks with the existing `PickCard` and `ReactionBar` and is replaced by the deck in Task 6.
- Modify:
  - `src/client/components/IdeaTitle.tsx`: restyle; keep rename.
  - `src/client/components/PreferencesPanel.tsx`: add `editRequest`; restyle.
  - `src/client/test/setup.ts`: stub `HTMLDialogElement.prototype.showModal` / `close`.
  - `src/client/App.tsx`: the idea route renders `IdeaScreen`; drop the `IdeaCard` stop-gap.

**Interfaces:**
- Consumes: `useIdeas` (`patch`, `rerun`, `remove`, `react`, `refine`); `shownTitle`; Task 1 `errorKind`.
- Produces:
  - **`Sheet({ open, onClose, title, children })`:**
    - a native `<dialog>` opened with `showModal()`, which gives focus containment, Escape and an inert background;
    - it returns focus to the element that was focused when it opened;
    - styled as a bottom sheet below 900 px and a centered dialog from 900 px.
  - **`PreferencesPanel`'s new prop `editRequest: number`:** a counter. When it changes (and is greater than 0) the panel enters edit mode with a fresh draft and `scrollIntoView`s itself. Editing stays locked while researching, as today.
  - **`IdeaScreen({ idea, status, onBack, actions })`.** Part 1 renders:
    - **Header:**
      - a back link (CSS hides it from 900 px);
      - kicker "Explore · round N";
      - `IdeaTitle` inside an `h1` with `tabIndex=-1`;
      - "You wrote “…” · notes · max € budget".
    - **Overflow menu** (button + `Sheet`):
      - for a wanted idea: Edit idea, Research again (`rerun`, hidden while queued or researching), Bought something else, Archive, Remove;
      - for a bought or archived idea: Want again and Remove;
      - Archive and Remove navigate to `#/`.
    - **Edit:** `IdeaForm` in a `Sheet`, with Save and "Save & research again" (unchanged behaviour).
    - **`StatusCard`:**
      - researching: one live line with `status.current.step`, plus "Usually a few minutes; you can leave";
      - queued;
      - retrying with **Try now** (`rerun`);
      - stopped with the error text and Try again (`rerun`);
      - nothing new, with **Loosen a criterion** and **Reword**:
        - Loosen bumps `editRequest`, and is hidden when `idea.preferences` is null;
        - Reword opens the edit sheet;
      - research off and quota.
    - **A bought idea** shows its bought snapshot (what · where · price) in place of the status card. Bought and archived ideas show no reactions and no refine.
    - **Body for now:** `PreferencesPanel`, then `PickList` (temporary), then the existing `RefineBar`.

- [ ] **Step 1: Write the failing tests:**
  - **Status card:** each status renders its card and actions, and Try now calls `rerun`.
  - **Loosen and Reword:**
    - Loosen opens the preferences editor and pressing it twice re-opens it;
    - Reword opens the edit sheet;
    - neither changes data by itself (spec decision 3);
    - Loosen is absent with null preferences.
  - **Menu:**
    - its actions call the right API and navigate home after Archive or Remove;
    - Research again is hidden while researching.
  - **Bought and archived ideas:** the menu shows only Want again and Remove; there are no reaction buttons.
  - **Ported from `IdeaCard.test`:**
    - rename saves, Escape cancels, and clearing hands the title back;
    - preferences are locked while researching;
    - the preferences draft survives a poll.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/02` (header), `05`, `08`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip idea screen: header, status card, menu and edit`.

### Task 6: Idea screen, part 2: the deck, refine dock, keepers, rounds

**Files:**
- Create: `src/client/components/PickDeck.tsx`, `src/client/components/PickDeck.test.tsx`, `src/client/components/PickRow.tsx`
- Modify:
  - `ReactionBar.tsx`: keycaps; keep the save-once why-not logic, and add the why-not card's quick chips;
  - `RefineBar.tsx`: becomes the dock;
  - `PickCard.tsx`: becomes the deck card;
  - `Keepers.tsx`, `EarlierRounds.tsx`, `IdeaScreen.tsx`.
- Delete: `PickList.tsx`.

**Interfaces:**
- Consumes: `useIdeas.react`, `refine`, `patch` (bought); the existing `ReactionBar`.
- Produces:
  - **`PickDeck({ idea, onReact, onBought })`.** The parent keys it by `idea.id` and the latest round, so a new round starts at its first unreacted pick.
    - **Position and keys.** State holds the current **pick id** (not an index), so a poll can't move it. The card subtree is keyed by `pick.id`; the keycap `ReactionBar` sits at deck level, keyed by `pick.id` too, so a why-not draft can never move to another pick. A polite live region announces "Pick N of M".
    - **The card** shows a photo (`pick.image`, with the placeholder when missing or `onError`; `draggable=false`), rank, a stamp for the reaction, title, price with ✓ checked or ≈ search price, sold out, over budget, shop, why, the "Check:" caveat, other shops, "I bought this" and "Open shop".
    - **Pips** have `aria-current` and jump to a pick.
    - **Advance after Yes or Kind of:** the deck moves to the next unreacted pick after 250 ms, or immediately with reduced motion. The timer is cleared on unmount, on a pip jump, and if the pick's reaction is no longer the one set (a rollback).
    - **No way** stays on the pick and shows the why-not card. Tapping the active reaction clears it.
    - **Swipe:** only `pointerType` touch or pen counts. It needs at least 90 px horizontally and more horizontal than vertical movement, with `touch-action: pan-y`. A drag suppresses the click that follows, and there is no fly-out under reduced motion.
    - **Arrow keys** move between picks while focus is in the deck.
    - **End card:** with no unreacted pick left after an advance, it shows "Round N sorted" with the tally and **Look again**, which jumps to pick 1 with no API call. Refine stays only in the dock.
  - **Why-not quick chips** (Too expensive / Not my style / Wrong type / Doubt the quality): a chip saves that text as the reason at once (through the same save-once path) and fills the input with it.
  - **`RefineBar`** becomes the sticky dock: "N reactions will steer round N+1" with "Refine with N". When disabled it looks disabled and shows the reason as text (today's rule, spec decision 7). It is sticky inside the right pane from 900 px, and to the viewport below.
  - **`PickRow({ pick, onReact })`:** a compact row (title, price, shop, keyed `ReactionBar`), used by `EarlierRounds` and `Keepers`, so they stay reactable.

- [ ] **Step 1: Write the failing tests** (use `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` with fake timers):
  - **Deck moves:**
    - Yes advances to the next unreacted pick after the timer;
    - a rollback inside 250 ms cancels the advance;
    - a poll that re-orders nothing keeps the current pick.
  - **No way and why-not:**
    - No way stays and shows why-not, and its reason saves once on Enter then blur (exact `writes()` list);
    - type a reason on pick A, jump with a pip, and the write goes to A only (never B);
    - a quick chip saves its text once;
    - tapping the active reaction sends `{reaction:null, reason:null}`.
  - **Navigation:**
    - pips jump;
    - after the last pick the end card shows the tally, and Look again goes to pick 1 without a write.
  - **Swipe:** a touch drag of 120 px right sends Yes; a mouse drag and a mostly vertical touch drag send nothing. Assert in the test that the handler sees `clientX`.
  - **Card content:** a missing or broken image shows the placeholder.
  - **Ported from `PickCard.test`:** checked ✓ vs ≈ price, sold out, over budget, other shops, I bought this.
  - **`IdeaScreen` (part 2):**
    - the refine dock is disabled with its reason as visible text, and enabled after a reaction;
    - Refine sends once (ported);
    - keepers and earlier rounds render as `PickRow`s and stay reactable.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** to `shots/02`, `03`, `04`, `06`, `07`.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Quote Slip idea screen: the deck, refine dock, keepers and rounds`.

### Task 7: Remove the old UI, then the visual check

**Files:**
- Delete:
  - `src/client/components/IdeaCard.tsx`, `IdeaCard.test.tsx`, `StatusBadge.tsx`, `PickCard.test.tsx` (its cases now live in `PickDeck.test.tsx` and `IdeaForm.test.tsx`);
  - `readCollapsed` / `writeCollapsed` in `lib/storage.ts` (the file too if nothing else uses it) and the "collapses a card" App test. Collapsing is dropped on purpose; the screens replace it.
  - Unused CSS.
- Modify: `src/client/App.tsx`, `src/client/App.test.tsx`. App-level flows go through the router:
  - add → appears in With the researcher;
  - open → react → refine;
  - remove → undo;
  - theme toggle;
  - Back from an idea restores focus to its row.

- [ ] **Step 1:** Delete the old components. Port any behaviour test still missing: list the deleted files' `it(` names and check each has a new home or is the dropped collapse.
- [ ] **Step 2: Run** `npm run build && npm test`. Expected: PASS, with no leftover imports and lint clean.
- [ ] **Step 3: Visual check** (process step, not committed). Using `~/tools/playwright`, drive the built app: `npm run build`, then `node dist-server/server/index.js` with `DATA_DIR` in a scratch dir, seeded by inserting rows into its SQLite DB (no API keys are needed to view). Screenshot at **390×844** and **1440×900**, light and dark:
  - home;
  - home with a long title (60 characters) and a long shop name (Review Focus 4);
  - idea with picks;
  - why-not open;
  - the end card;
  - researching;
  - nothing new;
  - lists (Bought);
  - the edit sheet;
  - the PC with nothing selected;
  - the PC with an idea open, after resizing to 390 (Review Focus 2).

  Compare against `docs/design/quote-slip/shots/`. Fix anything clipped, overlapping, misaligned, too loud or off-system, then screenshot again until clean.
- [ ] **Step 4: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `Remove the old card UI; visual fixes from the screenshot check`.

### Task 8: Docs

**Files:**
- Modify: `AGENTS.md` (client architecture: router, shell, screens, theme, font, triage; the server `errorKind`), `README.md` (what it looks like; works on phone and PC).

- [ ] **Step 1:** Update the docs to match the code.
- [ ] **Step 2: Run** `npm run build && npm test`. Expected: PASS.
- [ ] **Step 3: Commit** `Document the Quote Slip client`.
