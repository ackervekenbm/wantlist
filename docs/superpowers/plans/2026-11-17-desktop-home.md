# PC Home Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a PC (≥ 900 px), home is one centred column led by the add box; an open idea or the lists show the home list as a sidebar with **+ New idea**, and **← Home** is shown on a PC too.

**Architecture:** Keep `Shell`'s two panes and the single `HomeScreen` in the left pane. Which parts show is CSS keyed on `.shell[data-route]`: on a PC, home hides the right pane and centres the left; elsewhere the left pane is a 340 px sidebar that hides the add box and shows **+ New idea**. Both stay mounted, so a half-typed idea survives a trip to an idea. `useRouteFocus` puts the cursor in the add box when a PC lands on home.

**Tech Stack:** React 19, TypeScript, plain CSS tokens in `src/client/styles.css`, Vitest + Testing Library (jsdom, no CSS applied), Playwright from `~/tools/playwright` for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-17-desktop-home-design.md`

## Global Constraints

- Below 900 px nothing changes (layout, focus, tests).
- New styles use the `--*` tokens, never hardcoded colours; targets at least 44 px; animation honours `prefers-reduced-motion`.
- PC detection is one media query everywhere: `(min-width: 900px)`, matching the CSS breakpoint.
- Branch `feat/pc-home` off `main`; PR body carries `Fixes #66`; verify with `npm run build && npm test`.
- README and AGENTS.md are updated in the same PR (README "Phone and desktop" section, AGENTS.md `src/client/` paragraph).

## Review Focus

- A half-typed idea in the add box, then opening an idea and coming back: the text is still there (Task 2 test).
- Keyboard user on a PC: the hidden add box in the sidebar must not be reachable by Tab (`display:none`, checked in the Task 4 screenshots by tabbing).
- The 5 s poll re-rendering home on a PC must not pull focus back to the add box while the owner is elsewhere on the page (Task 3 test).
- A PC opening a deep link `#/idea/<id>` directly: sidebar + idea, no focus jump to a hidden add box (Task 3 test).
- First load on a PC before the ideas arrive: the add box is usable and focused while the sections show the skeleton (Task 3 test).

---

### Task 1: Shell without the empty placeholder

**Files:**
- Modify: `src/client/components/Shell.tsx`
- Test: `src/client/components/Shell.test.tsx`

**Interfaces:**
- Produces: `Shell` renders `right` in `.pane-right` on every route (home passes `null`); `LogoMark` import goes if unused.

- [ ] **Step 1:** Replace the test `shows the empty state in the right pane on home, the screen elsewhere` with `renders the right pane as given on every route`: on `{ name: 'home' }` with `right={null}` the right pane is empty and `queryByText('Pick an idea on the left, or add one')` is null; on `{ name: 'idea', id: 1 }` it contains `idea screen`.
- [ ] **Step 2:** Run `npx vitest run src/client/components/Shell.test.tsx` → FAIL (placeholder text still rendered).
- [ ] **Step 3:** Render `{right}` unconditionally in `.pane-right`; update the component doc comment (on a PC home shows the left pane alone, centred; elsewhere both).
- [ ] **Step 4:** Run the same command → PASS.
- [ ] **Step 5:** Commit `Drop the PC "pick an idea" placeholder` with `Fixes #66`.

### Task 2: + New idea in the sidebar

**Files:**
- Modify: `src/client/components/HomeScreen.tsx`, `src/client/App.tsx`
- Test: `src/client/components/HomeScreen.test.tsx`

**Interfaces:**
- Produces: `HomeScreen` prop `onNewIdea: () => void`; a `<button type="button" className="btn newidea">` labelled `+ New idea`, rendered above the add box (always in the DOM; CSS decides visibility in Task 4). `App` passes `onNewIdea={goHome}` (from `lib/route`).

- [ ] **Step 1:** Write `New idea goes home from an idea` (App-level, fakeApi, `history.replaceState(null, '', '#/idea/1')`): click the `+ New idea` button → `location.hash` is `#/` (or empty).
- [ ] **Step 2:** Write `keeps a half-typed idea while an idea is open`: on home type `fan for the bike` into the `Add an idea` form's textbox, click the idea's row, then the `Home` link → the textbox still holds `fan for the bike`.
- [ ] **Step 3:** Run `npx vitest run src/client/components/HomeScreen.test.tsx` → the first FAILS (no button); the second may already pass (the form is never unmounted today) and stays as a guard.
- [ ] **Step 4:** Add the prop and button to `HomeScreen`, wire `goHome` in `App`.
- [ ] **Step 5:** Run → PASS. Commit `Add + New idea to the home list for the PC sidebar` with `Fixes #66`.

### Task 3: Cursor in the add box when a PC lands on home

**Files:**
- Modify: `src/client/App.tsx` (`useRouteFocus`)
- Test: `src/client/components/HomeScreen.test.tsx`

**Interfaces:**
- Consumes: the add box is the `textarea` inside `form[aria-label="Add an idea"]` in `.pane-left`.
- Produces: `const onPc = (): boolean => window.matchMedia?.('(min-width: 900px)').matches ?? false` in `App.tsx`.

Tests stub `matchMedia` with `vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('min-width: 900px'), media: q }))` for "PC"; without the stub jsdom has no `matchMedia`, which counts as phone.

- [ ] **Step 1:** Write `PC: opening the app puts the cursor in the add box`: stubbed PC, `#/`, render `App` → `document.activeElement` is the add box textarea, also before `loaded` (assert right after the form appears, before awaiting the ideas).
- [ ] **Step 2:** Write `PC: going home from an idea puts the cursor in the add box`: stubbed PC, start at `#/idea/1`, click `Home` → add box focused.
- [ ] **Step 3:** Write `PC: a deep link to an idea focuses the idea, not the add box`: stubbed PC, `#/idea/1` → focus is the idea's `h1`, not the textarea.
- [ ] **Step 4:** Write `PC: a poll does not pull focus back to the add box`: stubbed PC, home, focus a row button, advance the poll (fake timers 5 s, as other polling tests do) → focus stays on the row.
- [ ] **Step 5:** Write `phone: going home from an idea focuses the idea's row` (no stub) — mirrors today's behaviour; keep it if an equivalent test already exists.
- [ ] **Step 6:** Run `npx vitest run src/client/components/HomeScreen.test.tsx` → steps 1 and 2 FAIL.
- [ ] **Step 7:** In `useRouteFocus`, when `route.name === 'home'` and `onPc()`: focus the add box on first mount and whenever arriving from another route; otherwise keep today's code. The effect must not refocus when only `loaded` changes while already home with focus elsewhere (step 4).
- [ ] **Step 8:** Run → PASS; run `npm test` → all green. Commit `Put the cursor in the add box when a PC opens home` with `Fixes #66`.

### Task 4: PC layout, Home link on a PC, docs, screenshots

**Files:**
- Modify: `src/client/styles.css` (shell section, `.back`), `src/client/components/BackLink.tsx` (doc comment only), `README.md`, `AGENTS.md`

**Interfaces:**
- Consumes: `.shell[data-route]`, `.pane-left`, `.app`, `.capture`, `.newidea` from Tasks 1–2.

- [ ] **Step 1:** CSS, all inside `@media (min-width:900px)`:
  - `.shell` grid columns `340px minmax(0,1fr)`.
  - `.shell[data-route="home"]`: one column; `.pane-right` `display:none`; `.pane-left` no border; `.app` `max-width:640px; margin:0 auto; padding-top` around 8vh so the add box sits high-centre; the add box a little larger (font-size 17px, more padding).
  - `.shell:not([data-route="home"]) .capture` → `display:none`; `.newidea` shown only there (`display:none` everywhere else, including phones), full width, ≥ 44 px.
  - Remove the rule hiding `.back` on a PC.
- [ ] **Step 2:** `BackLink` comment: "The way home, on a phone and a PC."
- [ ] **Step 3:** `npm run build && npm test` → green.
- [ ] **Step 4:** Screenshots with Playwright (`require('/home/ackervekenbm/tools/playwright/node_modules/playwright')`) against `npm run dev` with the in-memory data the client tests use, or the built app with a temp `DATA_DIR` and a few seeded ideas: 1280×800 home and idea, light and dark; 390×844 home and idea light. Check: add box centred and focused on home; sidebar with + New idea and highlighted row on the idea; Home link visible; phone unchanged; pressing Tab from the sidebar top never lands on a hidden add box.
- [ ] **Step 5:** README "Phone and desktop": on a PC home is the add box with what needs you below; an open idea keeps the list as a sidebar with + New idea and a Home link. AGENTS.md `src/client/` paragraph: replace "CSS alone shows one below 900 px (the route picks) and both from 900 px" with the new rule (PC home = left pane alone, centred; elsewhere a 340 px sidebar with `+ New idea`; `useRouteFocus` focuses the add box on a PC).
- [ ] **Step 6:** Commit `Lay out the PC home page and sidebar` with `Fixes #66`; push `feat/pc-home`; `gh pr create` with the screenshots described and `Fixes #66`.
