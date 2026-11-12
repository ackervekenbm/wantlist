# Quote Slip redesign (phase 1) — design

Issue #32. Builds on #31 (refine rounds). Status: draft for approval.

## Intent

The app works, but it doesn't feel like a tool the owner enjoys opening. After three design rounds (nine mockups, all in the session's design page) the owner chose **Quote Slip**: "a well-made pocket tool", with warm paper, keycap buttons that press down, prices laid out like a price list with dotted leaders, and a hunt's best offer drawn as a perforated quote slip. It is confident but never shouting, and home fits about one phone screen.

This phase gives **everything the app does today** that look and feel, on a **phone and in a PC browser**. Hunt mode (known products and refills: exact match, price per unit, last paid, "Running low") is phase 2, a separate project. Its screens are already in the mockup, so phase 1 builds the shell they will slot into.

## Reference

- `docs/design/quote-slip/mockup.html`: the chosen clickable mockup (open in a browser; a control panel beside the phone switches states). This is the visual source of truth for spacing, type, colour, components and copy.
- `docs/design/quote-slip/shots/`: screenshots at 390×844 (home and Explore in light and dark; the rest in light). They include the hunt screens (`09`, `11`, `14`, `16`) for phase 2.
- `docs/design/quote-slip/RATIONALE.md`: the designer's reasoning.

What the owner rejected along the way, so the build doesn't drift back: a dating-app swipe feel for known products, a plain "nothing to see" look, shouting buy buttons, and a home that scrolls on and on.

## Goals

- **Same features, new look and structure.** Every current feature keeps working: capture (text, budget, notes, Enter adds), researcher status, research states (queued, researching with the live step, retrying, stopped, out of quota, research off, nothing new), the model title with rename, editing the idea, reactions with why-not, refine, what I've learned (view and edit, locked while researching), keepers, earlier rounds (still reactable), "I bought this" / "bought something else", archive, remove with undo, want it again, the Wanted / Bought / Archived lists with a filter above 8 ideas, and light and dark themes.
- **Home** follows the mockup: capture, **Needs you** (picks to react to, nothing new found, stopped), **With the researcher** (queued, researching, retrying, with the live step on a dotted leader), then count tiles that open the lists. The Pantry section and tile are phase 2. Everything else that is wanted and resting is reached through the Wanted tile. In the common case (up to about 6 wanted ideas) home fits one 390×844 screen.
- **The Explore idea screen** follows the mockup: header (kicker, model title, "You wrote …"), status card, round bar with numbered pips, **one pick card at a time**, the three keycap reactions (✕ No way, ~ Kind of, ♥ Yes) with "tap again to clear", the why-not card (quick chips plus your own words), horizontal swipe on the card as a mirror of the buttons, what I've learned, keepers, earlier rounds, and the sticky refine dock.
- **PC browser (owner's choice: list and detail side by side).** From about 900 px wide: home on the left (fixed width, about 400 px), the open idea on the right. Nothing selected shows a short empty state on the right. Below 900 px: the phone layout, where opening an idea navigates to its own screen.
- **The browser Back button works.** Opening an idea, the lists screen and a list tab are addressable, so Back and a reload return to the same place, on the phone as well as the PC.

## Non-goals (this phase)

- Hunt mode, the Explore ⇄ Hunt switch, Pantry, Running low, exact-match offers, "Will you buy this again?" (phase 2).
- New research behaviour or API changes. The server is untouched unless a client need surfaces a missing field (none is known).
- Notifications, offline / installable app.
- A redesign of anything the mockup doesn't cover. Where it is silent, extend its system instead of inventing a new look.

## Anti-goals

- A button or banner that shouts (all-caps CTAs, neon blocks, oversized "BUY").
- Home growing into a long scroll in the common case.
- On a PC, a stretched phone layout or wide empty margins.
- Losing any behaviour the refine-rounds work fixed and tested: optimistic reactions with rollback, no stale poll undoing a reaction, why-not saved once, accessible names and `aria-pressed`, drafts that survive the 5-second poll, 44 px targets, focus handling.

## Constraints

- React 19 + Vite, plain CSS with `--*` tokens (light and dark, `prefers-color-scheme` plus the existing toggle). No CSS framework, no component library.
- The typeface is **Bricolage Grotesque**, shipped with the app (no request to Google Fonts at runtime; the app runs on a LAN Pi). Tabular figures for prices.
- Prices keep the Belgian formatting from `lib/format.ts` (€ 249,99).
- Real shop photos (`pick.image`) replace the mockup's placeholder art. A missing or broken photo falls back to the mockup's quiet placeholder.
- Accessibility at least as good as today: every control labelled, focus visible, contrast AA in both themes, `prefers-reduced-motion` honoured.

## Approaches

**Wide screens.** Considered:
- **A. List and detail side by side (chosen by the owner).** Home on the left, the open idea on the right; below about 900 px, the phone layout.
- B. One centered column, about 640 px. Simplest, but most of a PC screen stays empty and you go back and forth.
- C. A dashboard with Needs you, With the researcher and Pantry as columns. The most new design work and the furthest from Quote Slip.

**Order of work.** Considered, and the owner went with:
- **Redesign first (phase 1), then Hunt mode (phase 2).** The new look ships sooner and Hunt arrives as its own reviewed piece.
- Hunt first, then redesign: Hunt's screens would be built twice.
- Both in one project: one very large change, harder to review.

## Design

### Navigation (my call)

A small hash router (`#/`, `#/idea/<id>`, `#/lists/<wanted|bought|archived>`) without a dependency. On the phone it decides which screen shows; on a PC it decides which idea fills the right pane, with the home list always on the left. Back and reload work because the address changes. Removing or archiving the open idea returns to `#/`.

### Home

- **Top bar:** logo mark and name, the researcher chip (idle / researching with the idea's title / N queued / out of quota until … / research off), and the theme toggle.
- **Capture card:** textarea ("What do you want?") and Add, "+ Budget & notes", "Enter adds". Budget and notes appear below when opened.
- **Needs you:** rows with a mode glyph, the title, and a dotted-leader line: "React · round N …… N new picks", "Nothing new found …… round N", "Stopped …… try again". Each row opens the idea.
- **With the researcher:** compact rows with a status dot and the live step or "queued" on a dotted leader.
- **Count tiles:** Wanted, Bought, Archived (Pantry is added in phase 2). Each opens the lists screen on that tab.
- Banners for research off and out of quota, as in the mockup.
- Idea rows show the model title, falling back to the owner's text.

### Lists

A back link, the "Lists" heading, tabs with counts, the filter above 8 ideas, and rows with mode glyph, title and status line. Each row has its action: Archive on wanted, or Want again plus Remove (with undo) on bought and archived. Bought rows show what, where, the price and when.

### Explore idea screen

Follows the mockup screen by screen (`shots/02`–`08`). The specifics that matter:
- **Header:** a back link on the phone (none in the PC's right pane), kicker "Explore · round N", the model title with rename, "You wrote …" with notes and budget, and an overflow action set: edit idea, bought something else, archive, remove.
- **The deck:**
  - One pick card at a time: photo, rank, a stamp showing your reaction, title, price with ✓ checked or ≈ search price, shop, why, "Check:" caveat, other shops, "I bought this", "Open shop".
  - Pips jump between picks.
  - After Yes or Kind of the deck moves to the next unreacted pick. No way stays and opens the why-not card.
  - Swipe on the card mirrors the buttons. Only a clearly horizontal drag counts, and vertical scrolling never reacts.
- **Reactions** keep today's data behaviour (optimistic, rollback, clearing a reaction clears its reason, a stale reason never sticks to a Yes). Tapping the active one clears it.
- **Refine dock:** "N reactions will steer round N+1" with "Refine with N". When nothing can be learned yet it is disabled and **looks disabled**, with the reason shown as text.
- **What I've learned:** a summary plus ✓ / ✗ / ♥ rows. Editing is locked while researching. The existing edit behaviour (draft kept across polls, failed save keeps the draft) stays.
- **Keepers and earlier rounds:** as in the mockup, still reactable.
- **States:** researching (live steps), queued, retrying, stopped, nothing new (with "Loosen a criterion" and "Reword"), research off, out of quota.

### PC layout

- **≥ 900 px:** two panes. The left pane is home (capture, sections, tiles), about 400 px wide, scrolling on its own. The right pane is the open idea or the lists screen, scrolling on its own, with a comfortable reading width of about 640 px. The selected row is highlighted.
- **Empty right pane:** "Pick an idea on the left, or add one" with the quote-slip mark.
- The deck, slip and cards use the mockup's proportions; no element stretches to fill the width.
- Keyboard: Tab order follows left then right. While the pick card has focus, the arrow keys move between picks.

### Visual system

The mockup's tokens: warm paper `--bg`, `--surface`, `--ink` scale, rules, keycap edge, the deep green accent, brass, and the reaction colours. Dark values as in the mockup. Components carry over: keycap button, chip, dotted leader, section header with rule, card, glyph, slip with perforated edges, status card, sheet, toast.

### What it replaces

The current card list (`IdeaCard` expanding inline) and its styles are replaced, not restyled. The data layer (`useIdeas`, `api.ts`, server) stays. Components from the refine-rounds work are reused where their behaviour is right (reaction save-once logic, preferences draft handling, title rename) and re-skinned or split along the mockup's structure.

### Verification

- Unit and component tests keep passing and are updated to the new structure. The behaviours above that the anti-goals list stay covered by tests.
- **Visual check before review:** screenshots of every main screen and state at 390×844 and 1440×900, light and dark, using a local Playwright script (the dev box's headless Chromium). They are compared against the mockup's shots and anything off is fixed. This is a process step, not a CI job.

## Left to the builder

- Component split and file layout, within the existing `src/client` structure.
- Exact pixel values where the mockup and this document leave room. Follow the mockup.
- How the font is bundled (a `@fontsource` package or a woff2 file in the repo), as long as nothing is fetched from Google at runtime.
- Whether the old `IdeaCard` pieces are deleted or reshaped, as long as the tests for their behaviours survive.
