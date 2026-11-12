import type { FinalPick, HistoryPick, PickSupplier } from '../../types'

// Offer/URL helpers shared by the pipeline steps: product-level de-duplication,
// offer ordering, and the URL normalization the allowlists compare with.

/** One offer per URL, best first (see `compareOffers`). */
export function mergeSuppliers(suppliers: PickSupplier[]): PickSupplier[] {
  const byUrl = new Map<string, PickSupplier>()
  for (const s of suppliers) {
    const key = normalizeUrl(s.url)
    const existing = byUrl.get(key)
    if (!existing || compareOffers(s, existing) < 0) byUrl.set(key, s)
  }
  return [...byUrl.values()].sort(compareOffers)
}

const STOCK_ORDER = { in_stock: 0, preorder: 1, unknown: 1, out_of_stock: 2 } as const

/**
 * Buyable before not: in stock (or unknown) before out of stock; then a
 * price confirmed on the shop page before one only seen in search; then
 * cheapest; offers without a price last.
 */
export function compareOffers(a: PickSupplier, b: PickSupplier): number {
  return (
    STOCK_ORDER[a.availability] - STOCK_ORDER[b.availability] ||
    (a.price === null ? 1 : 0) - (b.price === null ? 1 : 0) ||
    (a.price ?? 0) - (b.price ?? 0) ||
    Number(b.checked) - Number(a.checked)
  )
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
      groups.set(key, { ...p })
      continue
    }
    existing.suppliers = mergeSuppliers([...existing.suppliers, ...p.suppliers])
    Object.assign(existing, primaryFields(existing.suppliers))
    existing.why ||= p.why
    existing.caveat ??= p.caveat
    existing.image ??= p.image
    existing.rating ??= p.rating
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...p.sourceUrls])]
  }
  return [...groups.values()]
}

/** The top-level shop/url/price a pick mirrors from its best offer. */
export function primaryFields(suppliers: PickSupplier[]): Pick<FinalPick, 'shop' | 'url' | 'price'> {
  const best = suppliers[0]
  return { shop: best.shop, url: best.url, price: best.price }
}

export function rankPicks(picks: FinalPick[]): FinalPick[] {
  return picks.map((p, i) => ({ ...p, rank: i + 1 }))
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** Query parameters that only track the click and never pick the product. */
const TRACKING_PARAM = /^(utm_\w+|gclid|gclsrc|dclid|gbraid|wbraid|fbclid|msclkid|srsltid|_ga|_gl|mc_[ce]id|ref_)$/i

/**
 * Comparable form of a URL: lower-case host, no fragment, no tracking
 * parameters (Google adds `srsltid` to shopping links), remaining parameters
 * sorted, no trailing slash. Product-identifying parameters (`?id=123`) stay,
 * so two products on one shop never collapse into one.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url)
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : ''
    return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, '')}${query}`
  } catch {
    return url.split('#')[0].replace(/\/+$/, '')
  }
}

/** Products the owner already saw: every pick and supplier URL, and every title (normalized). */
export interface Exclusion {
  urls: Set<string>
  titles: Set<string>
}

export function exclusionOf(picks: HistoryPick[]): Exclusion {
  return {
    urls: new Set(picks.flatMap((p) => p.urls.map(normalizeUrl))),
    titles: new Set(picks.map((p) => normalizeProductTitle(p.title))),
  }
}

export function isExcluded(
  item: { title: string; url: string; suppliers?: { url: string }[] },
  ex: Exclusion,
): boolean {
  const urls = [item.url, ...(item.suppliers ?? []).map((s) => s.url)]
  return ex.titles.has(normalizeProductTitle(item.title)) || urls.some((u) => ex.urls.has(normalizeUrl(u)))
}
