import type { Delivery, FinalPick, HuntTarget, OfferFacts, OfferGroup } from '../../types'

/** EUR a partner program gives back on a price at a shop URL; 0 when none. */
export type PartnerSaving = (url: string, price: number) => number

const cents = (n: number): number => Math.round(n * 100) / 100

/** Item price plus delivery; null when either is not known. */
export function deliveredPrice(price: number | null, d: Delivery): number | null {
  if (price === null) return null
  switch (d.kind) {
    case 'free':
      return cents(price)
    case 'paid':
      return d.cost === null ? null : cents(price + d.cost)
    case 'free_over':
      if (d.threshold !== null && price >= d.threshold) return cents(price)
      return d.cost === null ? null : cents(price + d.cost)
    default:
      return null
  }
}

const GROUP_ORDER: OfferGroup[] = ['best', 'exact', 'unavailable', 'mismatch']

/**
 * Fills delivered / perUnit / group and rank (1..n in display order).
 * Offers compare on what they cost after a partner discount (`saving`).
 * Pure: returns new objects.
 */
export function rankOffers<P extends Pick<FinalPick, 'suppliers'> & { offer?: OfferFacts | null; rank: number }>(
  offers: P[],
  target: HuntTarget,
  saving: PartnerSaving = () => 0,
): P[] {
  const rows = offers.flatMap((p) => {
    if (!p.offer) return []
    const s = p.suppliers[0]
    const price = s?.price ?? null
    const delivered = deliveredPrice(price, p.offer.delivery)
    const units = p.offer.packs * (p.offer.unitsPerPack ?? 1)
    const back = s && price !== null ? saving(s.url, price) : 0
    return [{ p, offer: p.offer, price, delivered, back, units, inStock: s?.availability === 'in_stock', checked: !!s?.checked }]
  })
  const perUnitMode = target.unit !== null && new Set(rows.map((r) => r.units)).size > 1
  const cmp = (r: (typeof rows)[number]): number =>
    ((r.delivered ?? r.price ?? Infinity) - r.back) / (perUnitMode ? r.units || 1 : 1)
  const sorted = [...rows].sort(
    (a, b) =>
      Number(b.inStock) - Number(a.inStock) ||
      cmp(a) - cmp(b) ||
      Number(b.delivered !== null) - Number(a.delivered !== null),
  )

  const wrongCondition = (o: OfferFacts): boolean =>
    !!o.condition && target.condition !== 'any' && o.condition !== target.condition
  const groupOf = (r: (typeof rows)[number]): OfferGroup =>
    r.offer.match === 'mismatch' || wrongCondition(r.offer)
      ? 'mismatch'
      : r.offer.delivery.kind === 'pickup_only' || r.offer.delivery.kind === 'no_be'
        ? 'unavailable'
        : 'exact'
  const eligible = sorted.filter((r) => groupOf(r) === 'exact' && r.checked && r.inStock && r.price !== null)
  const floor = eligible.find((r) => r.delivered !== null)
  // An unknown-delivery offer only wins when its item price is below every known delivered price.
  const best = eligible.find((r) => r.delivered === null && (!floor || cmp(r) < cmp(floor))) ?? floor ?? eligible[0]

  const grouped = sorted.map((r) => ({ r, group: r === best ? 'best' : groupOf(r) }))
  return GROUP_ORDER.flatMap((g) => grouped.filter((x) => x.group === g)).map(({ r, group }, i): P => {
    const offer: OfferFacts = {
      ...r.offer,
      delivered: r.delivered,
      perUnit: target.unit !== null && r.delivered !== null && r.units > 0 ? cents(r.delivered / r.units) : null,
      group,
      mismatch: group === 'mismatch' ? (r.offer.mismatch ?? r.offer.condition) : r.offer.mismatch,
    }
    return { ...r.p, offer, rank: i + 1 }
  })
}
