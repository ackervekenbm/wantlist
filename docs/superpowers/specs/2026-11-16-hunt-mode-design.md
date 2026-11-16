# Hunt mode — design

Date: 2026-11-16 · Status: draft for the owner's approval

## Intent

wantlist today only **explores**: a vague idea becomes 3–5 different products to
react to. Many purchases are the opposite: the owner knows (or has just decided)
exactly what to buy and only wants **the cheapest real offer for exactly that
product**. Often it is a refill (Feliway Friends 48 ml vials, illy Classico
beans) that comes back every few weeks; sometimes a one-off (an iPhone 17 Pro
256 GB, a refurbished Herman Miller Aeron size B).

Hunt is the second mode of an idea. It is also the natural second half of
exploring: explore "a refurbished Herman Miller desk chair", pick the model you
like, then **hunt that one**.

## Goals

- An idea is in **Explore** or **Hunt** mode. The first research run guesses
  the mode from the text; the owner can switch it at any time.
- **Hunt this one** on an Explore pick turns that idea into a hunt for that
  product. Explore rounds are kept and stay reachable.
- A hunt has a **target**: the exact product, variant and condition (new,
  refurbished, used, any), plus what does not count ("not Optimum, not
  Classic"). The model drafts it; the owner can edit it.
- The hunter finds offers for the exact target at shops that deliver to
  Belgium and ranks them by **what you pay, delivered**: item price plus
  delivery cost. Example the owner chose: €720 delivered free beats €650 + €80
  delivery, and beats €550 pick-up only in Utrecht.
- When pack sizes differ (3 × 48 ml vs 1 × 48 ml), offers compare on **price per
  unit** (per vial, per kg).
- **Bought here** records a purchase (what you paid, incl. delivery) and asks
  "Will you buy this again?" (pre-filled with the model's guess). Yes: the hunt
  is **covered** and sleeps in the **Pantry**. No: it moves to Bought.
- **Running low** on a covered hunt starts a new hunt in the background.
- Every purchase is kept: the slip says "9% less than last time · €21,95/vial at
  Zooplus, 14 Sep", and a covered hunt lists what you paid before.

## Non-goals (this version)

- Background price watching, scheduled re-hunts, notifications. Re-hunting is
  only ever started by the owner (Running low, Research again).
- Bill-discount partner programmes (Viking Deals, issue #52). Hunt's ranking
  must leave room for an "effective price" later, nothing more now.
- Second-hand marketplaces with private sellers (2dehands, Marktplaats):
  mostly pick-up, no delivery to rank on.
- Price history charts, alerts, coupon codes.

## Anti-goals (a failure even if it technically works)

- A "best offer" that is not the exact product (wrong variant, wrong
  condition, a different line like Feliway Optimum).
- A best offer that is cheaper only because delivery was ignored or guessed.
  A shipping cost is never invented and presented as fact.
- A best offer from a shop that does not deliver to Belgium, is pick-up only,
  trade-only, or out of stock.
- Hunt feeling like Explore's dating-app deck: no reactions, no swiping, no
  "No way" on offers. It reads like a quote.

## Constraints

- Free tiers: Gemini quota and 2,500 one-time Serper credits. A hunt may read
  more pages than an Explore round, but model calls stay at three per run
  (plan, select offers, verify offers) and Serper queries at most four.
- Pages are read with the existing `fetchPage` (12 s, 1.5 MB, bot walls count
  as unknown) and the per-run `PageCache`; at most 10 offer pages per hunt.
- The shop rules (consumer shops delivering to Belgium; Belgian and Dutch
  shops equal; no trade/horeca/wholesale, import resellers, far-away shops for
  everyday items) apply unchanged.
- `ideas.list` has a CHECK constraint (`wanted`/`bought`/`archived`); SQLite
  cannot alter it without a table rebuild. Pantry is therefore not a fourth
  list (see Data model).
- Migrations are append-only and must tolerate older databases; picks are never
  deleted by a re-run.
- Quote Slip design (tokens, keycaps, dotted leaders, brass = Hunt), phone and
  PC (two panes from 900 px), 44 px targets, reduced motion. The hunt screens in
  `docs/design/quote-slip/shots/` (09, 11, 14, 16) are the visual reference,
  with the corrections below.

## Approaches considered

- **A. Hunt as a mode of the same idea (chosen).** An idea gains `mode` and a
  `target`; a hunt run is a second pipeline in the same engine and worker; its
  offers are stored as picks of kind `offer`; a new `purchases` table holds what
  was paid. Reuses the queue, retries, quota handling, status card, lists and
  undo. One card, one history, and Explore → Hunt is a mode switch.
- B. Hunts as a separate entity linked to an idea. Cleaner on paper, but the
  whole lifecycle (queue, retries, errors, status UI) would exist twice.
- C. Hunt as Explore with a different prompt. Cheapest, but no delivered
  price, per-unit comparison, purchase history or Pantry: misses the point.

The owner handed over the how; A is the builder's pick.

## Decisions from the conversation

1. Explore → Hunt is a switch on the **same idea**, started from a pick (**Hunt
   this one**) or the Explore ⇄ Hunt switch. Explore rounds fold away under the
   hunt; switching back resumes Explore.
2. A hunt can also start directly when the text names a known product.
3. The **condition** (new / refurbished / used / any) is part of the target and
   the owner's choice. The mockup's "refurbished = mismatch" only holds when the
   target says new.
4. The target is editable ("size B or C", "any arms").
5. Ranking is by **delivered price**. When a page does not show delivery, the
   offer says "delivery not shown" and sorts on its item price, but it cannot be
   the best offer while another offer has a known delivered price at or below
   that item price.
6. **Pick-up only** and **no delivery to Belgium** offers sit in their own folded
   group, never on top. So do **not the exact product** offers.
7. Viking Deals waits (#52).

## Design

### Data model (migration 7)

`ideas`:
- `mode TEXT NOT NULL DEFAULT 'explore' CHECK (mode IN ('explore','hunt'))`
- `mode_by_owner INTEGER NOT NULL DEFAULT 0`: the owner switched it; research
  no longer re-guesses.
- `target TEXT` (JSON `HuntTarget`, below), `target_by_owner INTEGER NOT NULL DEFAULT 0`
- `refill INTEGER` (null = unknown): the model's guess, then the owner's answer
  in the Bought sheet.

`picks`:
- `kind TEXT NOT NULL DEFAULT 'pick' CHECK (kind IN ('pick','offer'))`
- `offer TEXT` (JSON `OfferFacts`, below), only for `kind = 'offer'`. A hunt
  offer is one pick row with exactly one supplier; its round is the hunt run.

New table `purchases`:
`id, idea_id (FK, ON DELETE CASCADE), at, shop, url, title, packs INTEGER,
units_per_pack REAL, unit_label TEXT, paid REAL (incl. delivery), per_unit REAL`.
Buying in either mode writes a purchase row; the existing `bought` snapshot
stays as it is for Explore and the API.

**Covered / Pantry** = `mode = 'hunt' AND list = 'bought' AND refill = 1`. No
new list value. Bought tab keeps showing everything bought; Pantry is its own
section on home and its own tab in Lists (a filter, not a list).

Types:

```ts
type Condition = 'new' | 'refurbished' | 'used' | 'any'
interface HuntTarget {
  product: string        // "Feliway Friends refill"
  variant: string        // "48 ml vial", "256 GB · Deep Blue", "size B"
  condition: Condition
  exclude: string[]      // "Feliway Optimum", "Classic"
  unit: string | null    // "vial", "kg" — null when packs never differ
}
type DeliveryKind = 'free' | 'paid' | 'free_over' | 'pickup_only' | 'no_be' | 'unknown'
interface OfferFacts {
  match: 'exact' | 'mismatch'
  mismatch: string | null           // "refurbished", "Optimum", "512 GB"
  packs: number                     // 3 (× 48 ml)
  unitsPerPack: number | null       // 1 vial per pack, 1000 g per bag
  delivery: { kind: DeliveryKind; cost: number | null; threshold: number | null }
  delivered: number | null          // item price + delivery when known
  perUnit: number | null            // delivered (or price) / total units
  condition: Condition | null
  sellerNote: string | null         // "Official reseller · 2-year warranty"
}
```

`Idea` gains `mode`, `modeByOwner`, `target`, `targetByOwner`, `refill`,
`purchases: Purchase[]`; `Pick` gains `kind` and `offer`.

### Research

The plan step (round 1) also returns `mode` and, for a hunt, a draft `target`
and `refill` guess. An idea whose mode the owner set is not re-guessed. When the
plan says hunt, the same run continues with the hunt pipeline, so a Feliway
idea never shows an Explore round first.

**Hunt pipeline** (`research/hunt.ts`, sharing search, `fetchPage`, `PageCache`,
the model router and the shop rules):

1. **Plan the hunt.** From the target: up to 4 queries aimed at shops selling
   exactly this (Dutch, as shops write it; one with the brand's own name; for
   refurbished, refurbishers). Step "looking for every shop that sells it".
2. **Search.** Serper as today; listing/category pages and repeat URLs dropped.
3. **Select offers.** The model picks up to 10 result URLs that look like an
   offer page for the target, one per shop where possible, and flags obvious
   mismatches. URLs must come from the results.
4. **Read and verify.** Every selected page is read once. One model call gets
   the target plus each page's text and shop data, and returns `OfferFacts` per
   offer: exact match or the mismatch reason, packs and units, condition,
   delivery (only what the page states: cost, "free over €X", pick-up only, no
   delivery to Belgium; else `unknown`), and a seller note. Price and stock come
   from the shop's product data first (as today's offer check), else the page.
5. **Rank** (code, not model; `research/rank.ts`):
   - `delivered` = price + cost (`free` → 0; `free_over` → 0 if price ≥
     threshold, else cost when stated, else unknown; `unknown` → null).
   - Compare on per-unit when `target.unit` is set and packs differ, else on
     the total.
   - **Eligible for best:** exact match, price checked at the shop, in stock,
     deliverable (not `pickup_only` / `no_be`).
   - Best = cheapest eligible with a known delivered price, unless an eligible
     offer with unknown delivery has an item price below it (then that one
     wins, flagged "delivery not shown": item price is a floor).
   - Groups, in order: best · other exact offers (sorted the same way, unknown
     delivery after known at equal price) · *pick-up only or no delivery to
     Belgium* (folded) · *not the exact product* (folded).
   - A cheaper price seen only in search (≈) gets one quiet note under the
     slip, never the slip.
6. A hunt that finds no eligible offer ends as `nothing-new`-style
   `no-results` with "No shop sells exactly this right now. Loosen the target
   or try again later."

Exclusion of earlier products does **not** apply to hunts: re-hunting is
supposed to find the same shops again with today's prices.

### API

- `PATCH /api/ideas/:id` also takes `mode` (sets `mode_by_owner`) and `target`
  (`null` hands it back to the model). Changing either while researching →
  409 like today.
- `POST /api/ideas/:id/hunt` `{ pickId?: number }`: switch to Hunt; with a pick,
  the target is drafted from that pick (title, the pick's shop page) in the next
  run. Queues a run, 202.
- `POST /api/ideas/:id/purchases` `{ pickId: number | null, paid: number,
  refill: boolean }`: writes the purchase (packs/units from the offer), moves
  the idea to `bought`, stores `refill`. 201 with the idea.
- `POST /api/ideas/:id/running-low`: covered hunt → `wanted`, queue a hunt run,
  202. 409 unless covered.
- `DELETE /api/purchases/:id`: for the undo after "Covered".

### Screens

All in the existing shell; brass marks Hunt.

- **Idea header:** the Explore ⇄ Hunt segmented switch (mockup 09). Eyebrow
  "HUNT · REFILL" / "HUNT · ONE-OFF" from `refill`.
- **Target plate:** product · variant · condition, the exclusions underneath;
  tap to edit in the existing Sheet (fields: product, variant, condition,
  not this).
- **Best offer slip** (perforated): shop, stock, seller note, leader rows for
  the pack price, delivery ("free", "€ 4,95", "free over € 49 ✓", "not shown"),
  the big delivered price (per unit when it applies, with "you pay €59,95"),
  the last-time comparison, **Bought here** and **Open shop**. "✓ checked
  <time>" at the top.
- **Other shops:** leader list (per unit or delivered, as the column header
  says), each with ✓/≈, pack, stock. Then the two folded groups.
- **Bought sheet** (mockup 14): "Bought at <shop>", paid (pre-filled with the
  delivered price, editable), "Will you buy this again?" two keycaps pre-set
  from `refill`, Save. Undo toast after save.
- **Covered stub** (mockup 16): "✓ COVERED since <date>", what you bought,
  **Running low**, and *You paid* (all purchases, per unit).
- **Explore pick card / Keepers row:** a **Hunt this one** action.
- **Home:** Needs you shows a done hunt as "best offer · €19,98/vial";
  With the researcher shows hunting steps; a **Pantry** section lists covered
  hunts, each with **Running low**. Lists gets a Pantry tab (filter).

### Testing

Hermetic as today: ranking unit tests (delivered price, free-over thresholds,
per-unit, the unknown-delivery rule, groups, eligibility); the hunt pipeline
with a scripted model, fake search and mocked `http.ts`; migration 7 on an old
database; route tests for the new endpoints and 409s; client tests for the
switch, plate, slip, Bought sheet, covered stub, Pantry and Hunt this one
against the in-memory API; phone and PC screenshots light and dark before
handover.

## Builder's calls (from the read-through; the owner can overrule)

1. **A done hunt stays in Needs you** ("best offer · €19,98/vial") until it is
   bought, archived or switched back to Explore. Acting on it means buying.
2. **"Hunt this one"** queues a run whose plan step gets the pick (title, shop
   URL, its preferences) and drafts the target from it; the condition defaults
   to what the idea's text and preferences say ("refurbished"), else `new`.
3. **The refill question is asked only when buying in Hunt.** Explore's
   *I bought this* keeps today's flow; it also writes a purchase row, so a
   later hunt of the same idea can compare with it.
4. **Buying also writes the existing `bought` snapshot,** so the Bought tab and
   `boughtLine` keep working unchanged.
5. **Undo after "Covered"** deletes the purchase and puts the idea back on
   `wanted` with its offers, as before the save.
6. **Switching a hunt back to Explore** shows the Explore rounds again; the
   hunt's offers fold under *Earlier hunts*. A refine from there is a normal
   Explore round.

## Left to the builder

Prompt wording; how the target is drafted from a pick; the exact
step texts; number formatting of per-unit labels; whether the folded groups
show counts; component split.
