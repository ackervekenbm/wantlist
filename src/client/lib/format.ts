import type { BoughtPick } from '../../types'

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
