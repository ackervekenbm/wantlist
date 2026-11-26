import type { BulkTier, Delivery, DeliveryKind, HuntTarget, OfferFacts, ResearchRequest } from '../../types'
import { ResearchError } from './errors'
import { isHttpUrl, normalizeUrl } from './offers'
import { SHOP_RULES, TARGET_SCHEMA, cleanQueries, cleanTarget, describeIdea, describeProduct } from './prompts'
import type { ProductData } from './product'
import type { SearchResult } from './search'
import { QUANTITY_MAX, TITLE_MAX } from '../../types/limits'

// Prompts, schemas and normalizers for a hunt: plan the queries, select offer
// pages from the search results, read the pages into OfferFacts. Like the
// Explore normalizers, they drop what the evidence does not back and throw an
// `invalid` ResearchError when nothing usable is left.

const SELECT_MAX = 10

function describeTarget(t: HuntTarget): string {
  return [
    `Product: ${t.product}`,
    t.variant && `Variant: ${t.variant}`,
    `Condition: ${t.condition}`,
    t.exclude.length > 0 && `Not wanted: ${t.exclude.join(', ')}`,
    t.unit && `Packs are compared per ${t.unit}`,
  ]
    .filter(Boolean)
    .join('\n')
}

const TARGET_RULE = `The target is EXACTLY this product: the same line, variant and size. A different
line (e.g. "Optimum" when the target is "Classic"), size or pack type is not it.
Condition: "new" means new only; "refurbished" means refurbished is exactly
what is wanted (a new one is then the mismatch); "any" accepts all.`

// ---------------------------------------------------------------------------
// Hunt step 1 - plan the queries
// ---------------------------------------------------------------------------

export const HUNT_PLAN_SYSTEM = `You are the planning step of a shopping bot that has NO internet access itself.
The owner wants to buy ONE exact product in Belgium (EUR) at the best price.
Work out the exact target and write 1 to 4 web-search queries that surface
shops selling exactly that product.

- Queries in Dutch, as Belgian and Dutch shops write them (e.g.
  "feliway classic navulling 48 ml kopen"). One query may use the brand's own
  product name or code.
- When the target is refurbished, add queries for refurbishers and shops with
  a refurbished range ("refurbished ... ", "gereviseerd ...").
- Keep queries specific enough to return product pages, not category pages.
- When a target is already given, keep it as is and only write queries.
- Give a short, specific English title, at most ${TITLE_MAX} characters.
- "refill": true when this is bought again when it runs out.

${TARGET_RULE}

${SHOP_RULES}`

export const HUNT_PLAN_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: `Short English name, ≤ ${TITLE_MAX} chars` },
    target: TARGET_SCHEMA,
    refill: { type: 'boolean', description: 'Will this be bought again when it runs out?' },
    searchQueries: { type: 'array', items: { type: 'string' }, description: '1-4 Dutch search queries' },
  },
  required: ['title', 'target', 'searchQueries'],
} as const

export function buildHuntPlanUser(req: ResearchRequest): string {
  const given = req.target ? `\nTarget already set by the owner (keep it):\n${describeTarget(req.target)}\n` : ''
  return `${describeIdea(req)}\n${given}\nReturn the hunt plan JSON per schema.`
}

export function normalizeHuntPlan(
  raw: unknown,
  current: HuntTarget | null,
  keepTarget: boolean,
): { target: HuntTarget; refill: boolean | null; title: string; searchQueries: string[] } {
  const obj = (raw ?? {}) as Record<string, unknown>
  const searchQueries = cleanQueries(obj.searchQueries, 'hunt plan')
  const target = keepTarget && current ? current : (cleanTarget(obj.target) ?? current)
  if (!target) throw new ResearchError('hunt plan has no target', { kind: 'invalid' })
  return {
    target,
    refill: typeof obj.refill === 'boolean' ? obj.refill : null,
    title: String(obj.title ?? '').trim().slice(0, TITLE_MAX),
    searchQueries,
  }
}

// ---------------------------------------------------------------------------
// Hunt step 2 - select offer pages from the search results
// ---------------------------------------------------------------------------

export const SELECT_SYSTEM = `You are the offer-selection step of a shopping bot.
You get the exact product the owner wants and search results (title | url |
snippet). Pick up to ${SELECT_MAX} results that look like the PRODUCT page of an offer for
this target.

- Use ONLY URLs from the result list, verbatim. Never invent or modify URLs.
- One page per shop where possible: the page most likely to be the exact
  product. Never a category, search, brand overview, blog, review or comparison page.
- Skip obvious mismatches (another line, size or condition than the target).
- Price: only if the snippet shows one, as a number in EUR; otherwise empty.

${TARGET_RULE}

${SHOP_RULES}`

export const SELECT_SCHEMA = {
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          shop: { type: 'string' },
          title: { type: 'string' },
          price: { type: 'number', description: 'EUR from the snippet, or omit' },
        },
        required: ['url', 'shop', 'title'],
      },
    },
  },
  required: ['offers'],
} as const

export function buildSelectUser(target: HuntTarget, rows: SearchResult[]): string {
  const lines = rows.map((r, i) => `${i + 1}. ${r.title} | ${r.url} | ${r.snippet}`).join('\n')
  return `Target:\n${describeTarget(target)}\n\nSearch results:\n${lines}\n\nReturn the offer pages JSON per schema. URLs must come verbatim from the list above.`
}

export function normalizeSelect(
  raw: unknown,
  allowed: Set<string>,
): Array<{ url: string; shop: string; title: string; price: number | null }> {
  const allowedNorm = new Set([...allowed].map(normalizeUrl))
  const seen = new Set<string>()
  const offers = (raw as { offers?: unknown })?.offers
  const out = (Array.isArray(offers) ? offers : [])
    .map((o: Record<string, unknown> | null) => ({
      url: String(o?.url ?? '').trim(),
      shop: String(o?.shop ?? '').trim(),
      title: String(o?.title ?? '').trim(),
      price: typeof o?.price === 'number' && Number.isFinite(o.price) && o.price > 0 ? o.price : null,
    }))
    .filter(
      (o) =>
        o.shop &&
        o.title &&
        isHttpUrl(o.url) &&
        allowedNorm.has(normalizeUrl(o.url)) &&
        !seen.has(normalizeUrl(o.url)) &&
        seen.add(normalizeUrl(o.url)),
    )
    .slice(0, SELECT_MAX)
  if (out.length === 0) throw new ResearchError('hunt selection has no usable offer', { kind: 'invalid' })
  return out
}

// ---------------------------------------------------------------------------
// Hunt step 3 - read the pages into offer facts
// ---------------------------------------------------------------------------

export const OFFER_SYSTEM = `You are the offer-reading step of a shopping bot.
You get the exact product the owner wants and the text of shop pages. For each
page return the facts of that shop's offer.

- match: "exact" only when the page sells exactly the target (line, variant,
  size, condition). Otherwise "mismatch", and "mismatch" names the difference
  in at most 4 words ("refurbished", "Optimum", "512 GB").
- packs: how many packs or items the offer sells together (1 for a single
  one). unitsPerPack: the count of the target's unit per pack (e.g. 48 ml
  vials per pack), only when stated.
- bulk: volume prices the page states for buying several ("vanaf 6 stuks
  -5%", "12 voor € 69", "3+ € 5,99/st"): min is the count the price starts
  at, with the price each in EUR or the percentage off. Leave out when the
  page shows none; never invent one.
- condition: new, refurbished, used, or leave out when the page does not say.
- delivery: ONLY what the page states: kind free, paid (with cost in EUR),
  free_over (with threshold in EUR, and cost when stated), pickup_only,
  no_be (does not deliver to Belgium), else "unknown". Never guess a shipping
  cost; when it is not on the page the kind is "unknown" and cost is empty.
- stock: what the page states for this offer: "in_stock" (op voorraad, en
  stock, morgen in huis, direct leverbaar), "out_of_stock" (uitverkocht,
  niet leverbaar), else "unknown". Never guess.
- sellerNote: one short English line about the seller or offer worth knowing
  (marketplace seller, delivery time, subscription price), or leave out.
- referral: true when the page does not sell the product itself but sends
  buyers on to another shop (a comparison, review or referral site whose buy
  button leads elsewhere); leave out otherwise.
- Only return pages from the list, with the url verbatim.

${TARGET_RULE}

${SHOP_RULES}`

export const OFFER_SCHEMA = {
  type: 'object',
  properties: {
    offers: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          url: { type: 'string' },
          title: { type: 'string', description: 'The product as the page names it' },
          match: { type: 'string', enum: ['exact', 'mismatch'] },
          mismatch: { type: 'string', description: 'The difference in ≤ 4 words; empty when exact' },
          packs: { type: 'number' },
          unitsPerPack: { type: 'number' },
          condition: { type: 'string', enum: ['new', 'refurbished', 'used'] },
          delivery: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['free', 'paid', 'free_over', 'pickup_only', 'no_be', 'unknown'] },
              cost: { type: 'number' },
              threshold: { type: 'number' },
            },
            required: ['kind'],
          },
          bulk: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                min: { type: 'number', description: 'From how many items the price applies' },
                each: { type: 'number', description: 'Price per item in EUR at that count' },
                percentOff: { type: 'number', description: 'Percentage off per item, when the page gives one instead' },
              },
              required: ['min'],
            },
          },
          sellerNote: { type: 'string' },
          referral: { type: 'boolean', description: 'The page only sends buyers to another shop' },
          stock: { type: 'string', enum: ['in_stock', 'out_of_stock', 'unknown'] },
        },
        required: ['url', 'title', 'match', 'packs', 'delivery'],
      },
    },
  },
  required: ['offers'],
} as const

export function buildOfferUser(
  target: HuntTarget,
  pages: Array<{ url: string; title: string; text: string; product: ProductData | null }>,
): string {
  const body = pages
    .map((p) => `--- PAGE: ${p.url} (${p.title}) ---\n${describeProduct(p.product)}${p.text}`)
    .join('\n\n')
  return `Target:\n${describeTarget(target)}\n\nPages:\n${body}\n\nReturn the offer facts JSON per schema, one entry per page.`
}

const DELIVERY_KINDS: DeliveryKind[] = ['free', 'paid', 'free_over', 'pickup_only', 'no_be', 'unknown']

const amount = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null

/** Tiers with a count of 2 or more and either a price each or a percentage off below 100; at most 6. */
function cleanBulk(raw: unknown): BulkTier[] {
  if (!Array.isArray(raw)) return []
  return raw
    .flatMap((t: Record<string, unknown> | null): BulkTier[] => {
      const min = typeof t?.min === 'number' && t.min >= 2 && t.min <= QUANTITY_MAX ? Math.round(t.min) : null
      const each = amount(t?.each) || null
      const pct = amount(t?.percentOff)
      const percentOff = each === null && pct !== null && pct > 0 && pct < 100 ? pct : null
      return min !== null && (each !== null || percentOff !== null) ? [{ min, each, percentOff }] : []
    })
    .slice(0, 6)
}

function cleanDelivery(raw: unknown): Delivery {
  const d = (raw ?? {}) as Record<string, unknown>
  const kind = DELIVERY_KINDS.includes(d.kind as DeliveryKind) ? (d.kind as DeliveryKind) : 'unknown'
  return { kind, cost: amount(d.cost), threshold: amount(d.threshold) }
}

export function normalizeOffers(
  raw: unknown,
  selected: Set<string>,
): Array<{
  url: string
  title: string
  referral: boolean
  /** Stock as the page text states it; the shop's product data wins over it. */
  stock: 'in_stock' | 'out_of_stock' | 'unknown'
  facts: Omit<OfferFacts, 'delivered' | 'perUnit' | 'group'>
}> {
  const selectedNorm = new Set([...selected].map(normalizeUrl))
  const offers = (raw as { offers?: unknown })?.offers
  const seen = new Set<string>()
  return (Array.isArray(offers) ? offers : [])
    .map((o: Record<string, unknown> | null) => ({ o: o ?? {}, url: String(o?.url ?? '').trim() }))
    .filter(
      ({ url }) =>
        isHttpUrl(url) && selectedNorm.has(normalizeUrl(url)) && !seen.has(normalizeUrl(url)) && seen.add(normalizeUrl(url)),
    )
    .map(({ o, url }) => {
      const match = o.match === 'exact' ? 'exact' : 'mismatch'
      const mismatch = String(o.mismatch ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 4).join(' ')
      const packs = typeof o.packs === 'number' && o.packs >= 1 ? Math.round(o.packs) : 1
      const units = typeof o.unitsPerPack === 'number' && o.unitsPerPack > 0 ? o.unitsPerPack : null
      const bulk = cleanBulk(o.bulk)
      const condition = ['new', 'refurbished', 'used'].includes(String(o.condition))
        ? (o.condition as 'new' | 'refurbished' | 'used')
        : null
      return {
        url,
        title: String(o.title ?? '').trim(),
        referral: o.referral === true,
        stock: o.stock === 'in_stock' || o.stock === 'out_of_stock' ? o.stock : 'unknown',
        facts: {
          match,
          mismatch: match === 'mismatch' ? mismatch || 'not the target' : null,
          packs,
          unitsPerPack: units,
          delivery: cleanDelivery(o.delivery),
          ...(bulk.length ? { bulk } : {}),
          condition,
          sellerNote: String(o.sellerNote ?? '').trim() || null,
        },
      }
    })
}
