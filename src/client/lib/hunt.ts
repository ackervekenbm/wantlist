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
