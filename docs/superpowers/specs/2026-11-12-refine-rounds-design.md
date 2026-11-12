# Refine rounds — design

Issue #30. Status: draft for approval.

## Intent

Today wantlist researches an idea once and shows 3–5 picks. In practice the
first set is a conversation starter, not an answer. When the owner showed the
slipper picks to their girlfriend, some were "absolutely not" and some were "kind
of okay". The app had no way to hear that, so the only option was to reword
the idea and start over.

The goal: whoever is looking reacts to each pick, can say **why not**, and
wantlist comes back later with a better round. It keeps going until one is
worth buying. Rounds run in the background like the first research ("type it
and walk away" stays the product's promise).

## Goals

- React to every pick: **No way** (with an optional "why not"), **Kind of**
  (right direction, not this one), **Yes** (a keeper).
- **Refine** turns all reactions so far into updated criteria (must-haves,
  things to avoid, liked traits). These are visible on the idea and can be
  edited. Then a new round is researched in the background.
- Earlier rounds and their reactions stay readable. Keepers stay in view.
- A rejected product never comes back in a later round.
- Once research has worked out what the idea is about, the card gets a
  **proper title** instead of the owner's half-formed prompt (owner's request).

## Non-goals (this version)

- Accounts or per-person reactions. Whoever holds the phone reacts, and a
  reaction is the idea's, not a person's.
- Notifications when a round is ready (ntfy is a later, separate idea). The
  card shows it.
- Learning from photos. The model sees product facts and the reasons, not
  images.
- Refreshing prices/stock of keepers from earlier rounds.
- The visual design. This version builds working UI in the current styles.
  The design overhaul (designer subagents) follows as its own project and
  builds on this flow.

## Anti-goals (would make it a failure even if it "works")

- A product marked **No way** shows up again in a later round, under any shop.
- A "why not" is silently ignored: the next round still has the trait she
  rejected, and nothing on screen shows wantlist understood the reason.
- A refine loses earlier rounds, reactions or keepers, or a failed refine
  leaves the idea without picks.
- Refining needs anyone to sit and wait.

## Constraints

- Free tiers. A round costs one extra model call (the learn step) plus the
  usual research: up to 4 Serper searches, a candidate step, a verify step,
  shop-page reads. Serper's 2,500 one-time credits are the scarcest resource,
  so a round must not search more than a first research does.
- Single user, no login, LAN only. Pi hardware. SQLite with append-only
  migrations (`PRAGMA user_version`) that must also tolerate pre-versioning
  databases.
- The research pipeline's rules stay: the model never browses, every pick's
  URL must come from real search results, the offer check reads the shop page.

## Approaches

Considered:

- **A. Re-research with reactions appended to every prompt.** Smallest. But
  each step interprets "looks like grandma's" on its own, nothing shows what
  was understood, and rounds drift.
- **B. Learn step, then research (chosen by the owner).** One short model call
  turns all reactions into updated, visible, editable criteria and targeted
  searches. The normal research then runs on them, with earlier products
  excluded in code. Costs one model call per round; in exchange the owner can
  check and correct what was learned.
- **C. Re-rank what round 1 already found.** No new search. Free and instant,
  but if every pick was wrong there's nothing better to show. Dropped.

## Design

### Words

- **Round**: one research result for an idea. The first research is round 1.
  Each refine (or manual "research again") makes the next round.
- **Reaction**: `no` | `maybe` | `yes` on one pick, plus an optional `reason`
  (free text, used mainly with `no`, allowed with all three).
- **Preferences**: what wantlist has learned about the idea. A summary plus
  three lists: `mustHaves`, `avoid`, `likes`. They replace today's flat
  `criteria` list.

### Data (migration 5)

- `picks.round INTEGER NOT NULL DEFAULT 1`. Picks are **no longer deleted**
  when a new round completes. `completeIdea` inserts the new round's picks with
  `round = idea.round + 1`.
- `picks.reaction TEXT` (`no`/`maybe`/`yes` or NULL) and `picks.reason TEXT`.
- `ideas.round INTEGER NOT NULL DEFAULT 0`: the latest **completed** round. It
  becomes 1 for existing ideas that have picks.
- `ideas.preferences TEXT` (JSON
  `{summary, mustHaves[], avoid[], likes[]}`). Existing ideas: `summary` from
  `ideas.summary`, `mustHaves` from `ideas.criteria`, the others empty. The old
  columns stay (append-only) but are no longer written.
- `ideas.title TEXT` (model-written, ≤ 60 characters) and
  `ideas.title_by_owner INTEGER NOT NULL DEFAULT 0`. NULL until the first
  successful round; existing ideas get one on their next round.
- `ideas.preferences_edited INTEGER NOT NULL DEFAULT 0`: set when the owner
  edits the preferences after the last round. This tells the learn step to
  treat the owner's edits as authoritative.

A failed round leaves earlier rounds and preferences untouched (as failures do
today). `boughtPickId` can point at a pick from any round.

### API

- `Idea` gains `title`, `round`, `preferences`; `Pick` gains `round`, `reaction`,
  `reason`. `Idea.picks` holds every round, newest round first, rank order
  within a round. `summary`/`criteria` leave the type.
- `PATCH /api/picks/:id` `{ reaction?: 'no'|'maybe'|'yes'|null, reason?:
  string|null }`. Reason up to 300 characters. 404 for an unknown pick. Any
  round's picks can be reacted to. Reacting doesn't start anything.
- `PATCH /api/ideas/:id` accepts `title` (1–60 characters, or `null` to hand
  naming back to wantlist). A non-null title sets `title_by_owner`.
- `PATCH /api/ideas/:id` also accepts `preferences` (same shape; each list
  ≤ 12 items of ≤ 120 characters, summary ≤ 300). It sets
  `preferences_edited`.
- `POST /api/ideas/:id/refine` queues the next round: 202 with the idea; 409
  while researching. It needs at least one reaction on any pick **or** edited
  preferences, else 400 (nothing to learn from). Like re-run it moves the idea
  back to `wanted` and kicks the worker.
- `POST /api/ideas/:id/rerun` (the existing "research again") becomes the same
  as refine but without the 400: it is the explicit "try again with what you
  know".

### Research

`ResearchRequest` gains a `history`: the current preferences, whether they were
edited by the owner, and every earlier pick as `{round, title, shop, price,
why, reaction, reason}`.

- **No history (round 1):** unchanged. The plan step writes summary, criteria
  (now as `mustHaves`; `avoid`/`likes` empty), queries, and a **`title`**:
  a short, specific name for what is being looked for (e.g. "Cozy open-back
  slippers for her"), ≤ 60 characters, in English.
- **History present (round ≥ 2):** the plan step is replaced by the **learn
  step**. Input: the idea (text, budget, notes), the current preferences
  (marked authoritative when edited), and every earlier pick with its reaction
  and reason. Output, as JSON per schema:
  - updated `preferences`: keep what still holds; turn each reason into a
    concrete `avoid` (or `mustHave`); turn `yes`/`maybe` picks into `likes`
    (traits, not product names); never drop an owner-edited item;
  - an updated `title` when what was learned sharpens it (else the current
    one);
  - 1–4 `searchQueries` aimed at what's still missing, phrased so they don't
    resurface rejected products.
  Normalizer rules: at least one query (else `invalid` → next model, as
  today); lists trimmed and capped as in the API limits.
- The **candidate** and **verify** steps receive the preferences (all three
  lists) instead of the flat criteria, plus a short "already shown, don't
  repeat" list of earlier titles.
- **Exclusion** (*builder-check call*): a product shown before must not return
  under any shop. Three layers:
  1. In code, after the candidate step and again after verify, drop any
     candidate/pick that matches an earlier pick on **any of its supplier
     URLs** (`normalizeUrl`, every entry of `suppliers`, not only `url`) or on
     its normalized product title (`normalizeProductTitle`).
  2. The candidate and verify prompts get the "already shown" list (title +
     shop).
  3. The verify schema gains `repeatOf: number | null` per pick: the index of
     the earlier product it is the same model as (same product, other
     shop/title). Picks with a `repeatOf` are dropped in code.

  It applies to every earlier pick, whatever its reaction: keepers are already
  on screen, and repeats waste a round. The one exception is after a reworded
  idea (below).
- **Nothing new left** (*builder-check call*): if exclusion leaves the
  candidate step with nothing, that answer is `invalid` and the next model gets
  a try, as today. When the chain ends that way, or verify ends with no picks
  after exclusion, the round fails with kind **`no-results`**, which stops and
  does not retry: retrying would only spend search credits on a market that
  has run out. The card says "Nothing new found. Loosen a criterion or reword
  the idea." All earlier rounds stay.
- A round that ends with no picks for any other reason fails the way round 1
  does today ("No product survived verification"), keeping all earlier rounds.
- On success: the new round's picks are stored, `ideas.round` +1, the new
  preferences replace the old, the model's title replaces the stored one
  unless `title_by_owner` is set (trimmed and capped at 60; an empty title
  keeps the old one), and `preferences_edited` is reset to 0.

### Editing the idea (owner's choice: option A)

- **Budget or notes change**: a tweak. Preferences, reactions and exclusions
  all carry over; the next round's learn step sees the new budget/notes.
- **Text change (reworded idea)**: a fresh start. On save, the stored
  preferences are cleared, and the next round runs the **plan step** (as
  round 1 does), not the learn step. Its history carries only the products
  marked **No way**, for exclusion; she still won't want those. Earlier rounds
  stay visible below, and round numbers keep counting up. The model writes a
  new title too, unless the owner named the card. Mechanism (e.g. an
  `ideas.fresh_since_round` marker set on a text change, so history only
  includes later reactions plus all `no` picks) is left to the builder.
- A plain **research again** is the same as refine (it finds new products).
  Refreshing the prices of picks already shown is out of scope.

### Preferences while a round runs (*builder-check call*)

Editing preferences is refused (409) while the idea is `researching`, and the
edit button shows "round in progress". Otherwise the finished round would
replace the owner's edit without anyone noticing. While `queued` the edit is
fine: the learn step reads preferences when the worker claims the idea.

The worker needs no new states. A refine is a queued idea, so retries, quota
handling, `kick()` and the 15-minute interval apply unchanged.
`state().current` shows "learning from your reactions" during the learn step.

### Screen (working UI, current styles)

On an idea card:

- **Title**: the model's title once a round is done, with the owner's own words
  underneath in smaller type ("you asked: …"). Before that, the owner's text
  as today. The title can be renamed in place; clearing it hands naming back.

- **Preferences strip** at the top: the summary, then chips for must-haves
  (✓), avoid (✗) and likes (♥). An edit button opens the three lists as
  editable chips (add / remove / reword). Saving PATCHes `preferences`.
- **Keepers**: picks marked Yes from any round, pinned above the current round
  and labelled with their round.
- **Current round**: the latest round's picks, each with three reaction
  buttons (✕ No way, ~ Kind of, ♥ Yes). Tapping No way reveals a one-line
  "why not?" field, which saves on blur/Enter. Tapping the active reaction
  again clears it. Reactions save immediately (optimistic, like the rest of
  `useIdeas`).
- **Refine button** under the current round: "Refine with N reactions"
  (counts reactions on the latest round not yet learned from). It is disabled,
  with a hint, when there's nothing to learn from. While a round is queued or
  researching, the card shows the live step, as research does today.
- **Earlier rounds**: collapsed, one line each ("Round 1 · 4 picks · 2 no ·
  1 kind of · 1 yes"). Expanding shows those picks with their reactions; they
  can still be changed.
- **"I bought this"** stays on every pick.

```
Slippers — round 2                  ✓ open back  ✗ faux fur  ✗ grandma look  ♥ felt
♥ Keepers:  Felt mule (round 1)  € 45 ✓
┌ [photo] Wool clog  € 52 ✓ · In stock ──────────────────────┐
│  ✕ No way   ~ Kind of   ♥ Yes                               │
└──────────────────────────────────────────────────────────────┘
[ Refine with 3 reactions ]
▸ Round 1 · 4 picks · 2 no · 1 kind of · 1 yes
```

### Tests

- db: migration 5 on a fresh DB, on a v4 DB with picks (round 1, preferences
  from summary/criteria), and on a pre-versioning DB; rounds accumulate;
  failure keeps rounds; reactions saved and cleared.
- title: plan/learn normalizers cap the title; completion keeps an
  owner-set title; rename/clear via PATCH.
- app: reaction PATCH validation (values, reason length, unknown pick),
  preferences PATCH limits, refine 400/409/202, rerun still always allowed.
- prompts: learn-step builder includes reasons and owner-edited flag; the
  normalizer caps lists and rejects zero queries; verify `repeatOf` parsed.
- pipeline: round ≥ 2 skips the plan step and uses the learn step; earlier
  picks are excluded on every supplier URL and on title, after both steps;
  `repeatOf` picks are dropped; all-excluded → next model, chain exhausted →
  `no-results` (no retry); a reworded idea runs the plan step and excludes only
  `no` picks.
- app/db: preferences PATCH → 409 while researching; text edit clears
  preferences, budget/notes edits keep them.
- worker: a refined idea passes history to the engine.
- client (fake API): react / clear / why-not; refine button counts and
  disabled state; earlier rounds collapse; keepers pinned; preferences edit
  round-trips.

## Left to the builder

- Exact prompt wording for the learn step and the adapted candidate/verify
  prompts, within the rules above.
- Whether `history` sends all earlier picks or the latest few rounds when an
  idea gets long. Keep the prompt under ~4k tokens of history; summarize older
  rounds to reaction counts plus reasons if needed.
- Component split on the client, and the exact chip-editor interaction.
- Whether "Refine with N" counts only unlearned reactions (needs a
  `learned_round` marker) or all reactions on the latest round. The latter is
  fine if the former adds complexity.
