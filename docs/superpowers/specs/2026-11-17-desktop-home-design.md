# PC home page

## Intent

On a PC, opening wantlist should feel like a chat app's start screen: the box
to add an idea is the main focus, with what needs you right under it, as on the
phone. From any idea there is an obvious way back to that page.

Today, from 900 px wide the screen is always split: a 400 px column holds the add
box and every list, and the rest shows the open idea or "Pick an idea on the
left, or add one". The add box sits in a side column next to an empty area.

## Goals

- Home on a PC is one centred column: top bar, a full-size add box with the
  cursor in it, then Needs you, With the researcher, Pantry and the list links.
- With an idea or the lists open, the list column is a sidebar: the same top
  bar and sections, the open idea highlighted, and a **+ New idea** button
  instead of the add box.
- **← Home** at the top of an idea and of the lists is shown on a PC too.

## Non-goals

- No change below 900 px.
- No new sidebar features (search, collapsing, resizing).

## Approaches

- **Reuse the home list for the sidebar (picked).** The phone already shows
  "home = list column only, idea = idea only". On a PC, home uses the same
  single column centred; an open idea shows that column as a sidebar beside it.
  `HomeScreen` gets a sidebar variant that swaps the add box for + New idea.
  Mostly CSS, no duplicated sorting or rows.
- **A separate Sidebar component.** Duplicates the sections and rows the home
  list already has; two places to keep in step. Rejected.
- **No sidebar, idea full width** (option B in the conversation). Calmer, but
  moving between ideas always goes through home; the owner picked the sidebar.

## Decided

- Layout and behaviour as in Goals (owner approved the sketch).
- Focus: on a PC, arriving on home puts the cursor in the add box, also when
  coming back from an idea. On the phone focus stays as it is (no keyboard
  popping up). (Claude's call, approved with the design.)
- The "Pick an idea on the left" placeholder is removed.

## Left to the builder

- Sidebar width (around 320–360 px) and how compact the sidebar rows are.
- The add box on home stays the compact one-line box (budget and notes behind
  their toggle, as on the phone), made a little larger on a PC. (Claude's call.)
