import type { BulkTier, Delivery } from './index'
import { QUANTITY_MAX } from './limits'

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

/** The price of one item when buying `qty`: the cheapest bulk tier that applies, else `price`. */
export function priceEach(price: number, bulk: BulkTier[] | undefined, qty: number): number {
  let each = price
  for (const t of bulk ?? []) {
    if (qty < t.min) continue
    const tier = t.each ?? (t.percentOff !== null ? price * (1 - t.percentOff / 100) : price)
    each = Math.min(each, tier)
  }
  return cents(each)
}

/** The smallest number (2 or more) whose total reaches a "free over" threshold, with the price each at that number. */
export function freeDeliveryAt(price: number | null, d: Delivery, bulk?: BulkTier[]): { qty: number; each: number } | null {
  if (price === null || price <= 0 || d.kind !== 'free_over' || d.threshold === null || price >= d.threshold) return null
  for (let qty = 2; qty <= QUANTITY_MAX; qty++) {
    const each = priceEach(price, bulk, qty)
    if (each * qty >= d.threshold) return { qty, each }
  }
  return null
}
