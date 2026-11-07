import type { FinalPick, PickSupplier } from '../../types'

// Offer/URL helpers shared by the pipeline steps: product-level de-duplication,
// supplier ordering, and the URL normalization the allowlists compare with.

export function mergeSuppliers(suppliers: PickSupplier[]): PickSupplier[] {
  const byUrl = new Map<string, PickSupplier>()
  for (const s of suppliers) {
    const key = normalizeUrl(s.url)
    const existing = byUrl.get(key)
    if (!existing || priceRank(s.price) < priceRank(existing.price)) {
      byUrl.set(key, s)
    }
  }
  return [...byUrl.values()].sort((a, b) => priceRank(a.price) - priceRank(b.price))
}

export function normalizeProductTitle(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').replace(/[.,:;!?]+$/g, '').trim()
}

/**
 * Code-level safety net: group picks that name the same product, so an
 * identical product never shows up twice (primary grouping is done by the
 * model in the verify prompt; this catches what slips through).
 */
export function mergePicksByProduct(picks: FinalPick[]): FinalPick[] {
  const groups = new Map<string, FinalPick>()
  for (const p of picks) {
    const key = normalizeProductTitle(p.title)
    const existing = groups.get(key)
    if (!existing) {
      groups.set(key, p)
      continue
    }
    existing.suppliers = mergeSuppliers([...existing.suppliers, ...p.suppliers])
    const primary = existing.suppliers[0]
    existing.shop = primary.shop
    existing.url = primary.url
    existing.price = primary.price
    if (!existing.why) existing.why = p.why
  }
  return [...groups.values()]
}

export function rankPicks(picks: FinalPick[]): FinalPick[] {
  return picks.map((p, i) => ({ ...p, rank: i + 1 }))
}

function priceRank(price: string | null): number {
  if (!price) return Number.MAX_SAFE_INTEGER
  const m = /(\d+(?:[.,]\d+)?)/.exec(price)
  return m ? Number.parseFloat(m[1].replace(',', '.')) : Number.MAX_SAFE_INTEGER
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function normalizeUrl(url: string): string {
  return url.split(/[?#]/)[0].replace(/\/+$/, '')
}
