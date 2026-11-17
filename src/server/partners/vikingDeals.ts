import type { PartnerDeal, PartnerProgram, PartnerShop } from './index'

// shortcut: an unofficial, versioned endpoint (the public partner page reads it); when it changes,
// partner data is simply empty until this URL is updated.
const LISTINGS_URL = 'https://vikingdeals.be/api/20261001/catalog/listings/'
const PARTNER_PAGE = 'https://mobilevikings.be/en/viking-deals/partners/'

interface Value {
  amount?: unknown
  type?: unknown
}

interface Listing {
  slug?: unknown
  title?: unknown
  is_published?: unknown
  cookie_rules?: { url?: unknown }[] | null
  deals?: {
    deal_type?: unknown
    value?: Value | null
    baseline_value?: Value | null
    description?: unknown
    start_date?: unknown
    end_date?: unknown
  }[] | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * Mobile Vikings' Viking Deals: a percentage of an online purchase comes back
 * as Viking Points (1 point = €1 off the phone bill), when the purchase starts
 * from the partner's Viking Deals page.
 */
export const vikingDeals: PartnerProgram = {
  id: 'viking-deals',
  name: 'Viking Deals',
  async load(fetchFn, today) {
    const res = await fetchFn(LISTINGS_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return parseListings(await res.json(), today)
  },
}

/**
 * Online (`affiliate`) percentage deals only: gift cards, fixed-point and
 * monthly deals are for subscriptions, not a shop price. A promotion outside
 * its dates falls back to its baseline. 0% rows (exclusions) are left out.
 */
export function parseListings(raw: unknown, today: string): PartnerShop[] {
  if (!Array.isArray(raw)) throw new Error('partner list is not an array')
  return (raw as Listing[]).flatMap((l): PartnerShop[] => {
    const slug = str(l?.slug)
    if (!slug || l.is_published === false) return []
    const deals = (l.deals ?? []).flatMap((d): PartnerDeal[] => {
      if (d?.deal_type !== 'affiliate') return []
      const start = str(d.start_date)
      const end = str(d.end_date)
      const live = (!start || start <= today) && (!end || end >= today)
      const v = live ? d.value : d.baseline_value
      if (v?.type !== 'percentage' || typeof v.amount !== 'number' || !(v.amount > 0)) return []
      const scope = (str(d.description) ?? '').replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim()
      return [{ percent: v.amount, scope, until: live ? end : null }]
    })
    if (deals.length === 0) return []
    const hosts = (l.cookie_rules ?? []).map((r) => str(r?.url)).filter((h): h is string => h !== null)
    const title = str(l.title)
    return [{ hosts, names: title ? [slug, title] : [slug], deals, link: `${PARTNER_PAGE}${encodeURIComponent(slug)}/` }]
  })
}
