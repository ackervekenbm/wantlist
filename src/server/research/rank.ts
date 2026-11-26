import type { FinalPick, HuntTarget, OfferFacts, OfferGroup } from '../../types'
import { deliveredPrice, priceEach } from '../../types/bulk'

export { deliveredPrice }

/** EUR a partner program gives back on a price at a shop URL; 0 when none. */
export type PartnerSaving = (url: string, price: number) => number

const cents = (n: number): number => Math.round(n * 100) / 100

const GROUP_ORDER: OfferGroup[] = ['best', 'exact', 'unavailable', 'mismatch']

/**
 * Fills delivered / perUnit / group and rank (1..n in display order).
 * With a target quantity, every offer is priced for that many: its bulk
 * price each, delivery judged on the total. Offers compare on what they cost
 * after a partner discount (`saving`).
 * Pure: returns new objects.
 */
export function rankOffers<P extends Pick<FinalPick, 'suppliers'> & { offer?: OfferFacts | null; rank: number }>(
  offers: P[],
  target: HuntTarget,
  saving: PartnerSaving = () => 0,
): P[] {
  const qty = target.quantity ?? 1
  const rows = offers.flatMap((p) => {
    if (!p.offer) return []
    const s = p.suppliers[0]
    const one = s?.price ?? null
    const price = one === null ? null : cents(priceEach(one, p.offer.bulk, qty) * qty)
    const delivered = deliveredPrice(price, p.offer.delivery)
    const units = qty * p.offer.packs * (p.offer.unitsPerPack ?? 1)
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
      perUnit: (target.unit !== null || qty > 1) && r.delivered !== null && r.units > 0 ? cents(r.delivered / r.units) : null,
      group,
      mismatch: group === 'mismatch' ? (r.offer.mismatch ?? r.offer.condition) : r.offer.mismatch,
    }
    return { ...r.p, offer, rank: i + 1 }
  })
}
