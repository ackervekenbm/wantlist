import type { Idea, Pick, Purchase } from '../../types'

/** The newest hunt round's offers, in rank order (picks arrive newest round first). */
export function offersOf(idea: Idea): Pick[] {
  const offers = idea.picks.filter((p) => p.kind === 'offer')
  return offers.filter((p) => p.round === offers[0]?.round)
}

/** Explore picks only; hunt offers live in their own lists. */
export function exploreRounds(idea: Idea): Pick[] {
  return idea.picks.filter((p) => p.kind === 'pick')
}

export function bestOffer(idea: Idea): Pick | null {
  return offersOf(idea).find((o) => o.offer?.group === 'best') ?? null
}

/** How this offer compares with what you paid last: per unit when both have one, else delivered vs paid. Negative = cheaper. */
export function versusLast(idea: Idea, offer: Pick): { pct: number; last: Purchase } | null {
  const last = idea.purchases[0]
  const facts = offer.offer
  if (!last || !facts) return null
  const [now, then] =
    facts.perUnit !== null && last.perUnit !== null ? [facts.perUnit, last.perUnit] : [facts.delivered, last.paid]
  if (now === null || then <= 0) return null
  return { pct: Math.round(((now - then) / then) * 100), last }
}

export function huntEyebrow(idea: Idea): string {
  return idea.refill === null ? 'HUNT' : idea.refill ? 'HUNT · REFILL' : 'HUNT · ONE-OFF'
}

/** The unit offers are compared per: only when the target has one and the exact offers come in different pack sizes. */
export function unitOf(idea: Idea): string | null {
  const unit = idea.target?.unit
  if (!unit) return null
  const sizes = new Set(
    offersOf(idea)
      .filter((o) => o.offer?.group === 'best' || o.offer?.group === 'exact')
      .map((o) => unitsIn(o)),
  )
  return sizes.size > 1 ? unit : null
}

function unitsIn(o: Pick): number {
  return (o.offer?.packs ?? 1) * (o.offer?.unitsPerPack ?? 1)
}

/** What an offer costs as shown: per unit when `unit` is set, else delivered; the item price stands in when delivery is not shown. */
export function figureOf(o: Pick, unit: string | null): number | null {
  const f = o.offer
  if (!unit || !f) return f?.delivered ?? o.price
  return f.perUnit ?? (o.price === null ? null : o.price / unitsIn(o))
}

/** "3 × 48 ml vial": packs of the target's variant, else the offer's own title. */
export function packText(packs: number, idea: Idea, fallback: string): string {
  return idea.target?.variant ? `${packs} × ${idea.target.variant}` : fallback
}
