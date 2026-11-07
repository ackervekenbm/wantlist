const eur = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
const eurWhole = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/** "€ 249,99", or "€ 229" for whole amounts. */
export function formatEur(value: number): string {
  return Number.isInteger(value) ? eurWhole.format(value) : eur.format(value)
}
