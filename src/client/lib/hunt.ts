import type { Idea, Pick, Purchase } from '../../types'
import { freeDeliveryAt, priceEach } from '../../types/bulk'
import { eurTight } from './format'

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

/** How many the owner buys at once: the target's quantity, else one. */
export function quantityOf(idea: Idea): number {
  return idea.target?.quantity ?? 1
}

/**
 * How this offer compares with what you paid last, per item (unit, pack, tin)
 * so a dozen bought last time compares fairly with one now. Negative = cheaper.
 * `then` is the last price per item; `units` how many items that purchase held.
 */
export function versusLast(idea: Idea, offer: Pick): { pct: number; last: Purchase; then: number; units: number } | null {
  const last = idea.purchases[0]
  const f = offer.offer
  if (!last || !f || f.delivered === null) return null
  const units = last.packs * (last.unitsPerPack ?? 1)
  const now = f.delivered / (quantityOf(idea) * f.packs * (f.unitsPerPack ?? 1))
  const then = last.paid / units
  if (then <= 0) return null
  return { pct: Math.round(((now - then) / then) * 100), last, then, units }
}

/** "Buy 12 for free delivery · €6,59 each": only with no quantity set and a free-delivery threshold more than one reaches. */
export function freeDeliveryHint(idea: Idea, o: Pick): string | null {
  if (quantityOf(idea) > 1 || !o.offer || o.offer.foundDelivery) return null
  const at = freeDeliveryAt(o.price, o.offer.delivery, o.offer.bulk)
  return at && `Buy ${at.qty} for free delivery · ${eurTight(at.each)} each`
}

/** "Bulk price: 6+ €6,26 each · 12+ €5,75 each", from what the shop page states. */
export function bulkText(o: Pick): string | null {
  const bulk = o.offer?.bulk
  if (!bulk?.length || o.price === null) return null
  const price = o.price
  return `Bulk price: ${bulk.map((t) => `${t.min}+ ${eurTight(priceEach(price, [t], t.min))} each`).join(' · ')}`
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

/**
 * What an offer costs as shown: per unit when `unit` is set, else delivered;
 * the item price (bulk price × `qty`) stands in when delivery is not shown.
 */
export function figureOf(o: Pick, unit: string | null, qty = 1): number | null {
  const f = o.offer
  const items = o.price === null ? null : priceEach(o.price, f?.bulk, qty) * qty
  if (!unit || !f) return f?.delivered ?? items
  return f.perUnit ?? (items === null ? null : items / (qty * unitsIn(o)))
}

/** "3 × 48 ml vial": packs of the target's variant, else the offer's own title. */
export function packText(packs: number, idea: Idea, fallback: string): string {
  return idea.target?.variant ? `${packs} × ${idea.target.variant}` : fallback
}
