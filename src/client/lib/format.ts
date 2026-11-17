import type { BoughtPick, Delivery } from '../../types'

const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
const eurWhole = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/** "€ 249,99", or "€ 229" for whole amounts. */
export function formatEur(value: number): string {
  return Number.isInteger(value) ? eurWhole.format(value) : eur.format(value)
}

/** "14:30" today, "Mon 14:30" otherwise. */
export function clockTime(iso: string, now = new Date()): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'later'
  const sameDay = d.toDateString() === now.toDateString()
  return d.toLocaleString(
    'en-GB',
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' },
  )
}

const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' })

/** What you bought: "title · shop · € 249,99 · 7 Nov", skipping what is unknown. */
export function boughtLine(b: BoughtPick): string {
  const when = Number.isNaN(Date.parse(b.at)) ? null : dayMonth.format(new Date(b.at))
  return [b.title, b.shop, b.price === null ? null : formatEur(b.price), when].filter(Boolean).join(' · ')
}

/** A compact price: "€ 249,99 ✓" when checked on the shop page, "≈ € 249,99" from search. */
export function priceText(price: number, checked: boolean): string {
  return checked ? `${formatEur(price)} ✓` : `≈ ${formatEur(price)}`
}

/** "€59,95": always cents, no space, for the figures on a hunt. */
export function eurTight(amount: number): string {
  return eur.format(amount).replace(/\s/g, '')
}

/** "€19,98/vial". */
export function perUnitText(amount: number, unit: string): string {
  return `${eurTight(amount)}/${unit}`
}

/** "14 Sep". */
export function shortDate(iso: string): string {
  return dayMonth.format(new Date(iso))
}

/** What delivery costs: "free", "€ 4,95", "free over € 49 ✓" (✓ once the price reaches it), or why it is unknown. */
export function deliveryText(d: Delivery, price: number | null): string {
  switch (d.kind) {
    case 'free':
      return 'free'
    case 'paid':
      return d.cost === null ? 'delivery not shown' : formatEur(d.cost)
    case 'free_over':
      if (d.threshold === null) return 'delivery not shown'
      return `free over ${formatEur(d.threshold)}${price !== null && price >= d.threshold ? ' ✓' : ''}`
    case 'pickup_only':
      return 'pick-up only'
    case 'no_be':
      return 'no delivery to Belgium'
    default:
      return 'delivery not shown'
  }
}

const pct = new Intl.NumberFormat('nl-BE', { maximumFractionDigits: 2 })

/** "2%", or "1,5–2,5%" when the rate depends on what you buy. */
export function percentText(min: number, max: number): string {
  return max > min ? `${pct.format(min)}–${pct.format(max)}%` : `${pct.format(min)}%`
}
