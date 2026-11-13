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
    undefined,
    sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' },
  )
}
