import type { FinalPick, Pass1Result, PickSupplier, ResearchCandidate } from '../../types'
import { ResearchError } from './errors'
import { isHttpUrl, mergePicksByProduct, mergeSuppliers, normalizeUrl, primaryFields, rankPicks } from './offers'
import { parsePriceEur, type ProductData } from './product'

// Prompts, response schemas, user-message builders and normalizers for the
// three model steps. Normalizers are the safety net: they drop anything the
// evidence does not back (URLs outside the allowed set in particular), and
// throw an `invalid` ResearchError when nothing usable is left, so the router
// tries the next model instead of failing the idea.

// ---------------------------------------------------------------------------
// Step 1 - research plan (no browsing: the app does the searching)
// ---------------------------------------------------------------------------

export const QUERY_SYSTEM = `You are the planning step of a shopping-research bot that has NO internet access itself.
A user describes a vague buying idea in plain words. Determine what they really
want, then produce targeted web-search queries that will surface BUYABLE
candidate products in Belgium.

Requirements:
- Country Belgium, prices EUR.
- Cover the whole market: the big players (bol, Coolblue, Amazon), specialist
  or smaller retailers, brand sites and EU shops with BE shipping. Do not stop
  at the big marketplaces - look beyond them too - but do not exclude them.
- Only real search queries, in English, that a search engine can answer.
  2 to 4 queries. Mix directions: product-oriented, review/community opinion
  ("best ... for ...", "... reddit"), and a specialist or brand-store query.
- Keep queries specific enough to return product pages, not category homepages.`

export const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    summary: {
      type: 'string',
      description: 'One sentence on what the user is really after',
    },
    criteria: {
      type: 'array',
      items: { type: 'string' },
      description: 'What matters when buying this (2-5 short bullets)',
    },
    searchQueries: {
      type: 'array',
      items: { type: 'string' },
      description: '2-4 real search queries',
    },
  },
  required: ['summary', 'criteria', 'searchQueries'],
} as const

export interface ResearchPlan {
  summary: string
  criteria: string[]
  searchQueries: string[]
}

export function buildQueryUser(ideaText: string): string {
  return `Idea to research:\n"${ideaText}"\n\nReturn the research plan JSON per schema.`
}

export function normalizePlan(raw: unknown): ResearchPlan {
  const obj = raw as Partial<ResearchPlan>
  const queries = (Array.isArray(obj.searchQueries) ? obj.searchQueries : [])
    .map((q) => String(q).trim())
    .filter(Boolean)
    .slice(0, 4)
  if (queries.length === 0) {
    throw new ResearchError('plan has no search queries', { kind: 'invalid' })
  }
  return {
    summary: String(obj.summary ?? '').trim(),
    criteria: Array.isArray(obj.criteria) ? obj.criteria.map(String).filter(Boolean) : [],
    searchQueries: queries,
  }
}

// ---------------------------------------------------------------------------
// Step 2 - pick candidates from real search results
// ---------------------------------------------------------------------------

export const CANDIDATE_SYSTEM = `You are the candidate-selection step of a shopping-research bot.
You are given search-engine results (title | url | snippet) for a Belgian
shopping idea. Choose 3-5 candidate products the user could reasonably buy.

Ground rules:
- Belgium, EUR.
- All shop types are legitimate: big marketplaces and brand stores when they
  genuinely fit, specialist and smaller retailers too. The mix should reflect
  the real market - never limit the list to one shop type.
- A candidate is a PRODUCT, not a shop. If the same product appears at several
  shops in the results, list it ONCE with its best offer (lowest price) - you
  cannot list the same product twice.
- Use ONLY URLs from the provided result list. Never invent or modify URLs.
- Price: only if the snippet actually shows one, as a bare number or short
  range in EUR. Otherwise leave empty.
- Each candidate: concrete product title, shop name, the exact result URL, a
  one-line "why this fits" grounded in the idea.
- Prefer product pages over category/home/aggregator pages.`

export const CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    candidates: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          shop: { type: 'string' },
          url: { type: 'string' },
          price: { type: 'string', description: 'e.g. "129" or "129-180" or empty' },
          why: { type: 'string', description: 'One short line, <=180 chars' },
        },
        required: ['title', 'shop', 'url'],
      },
    },
  },
  required: ['candidates'],
} as const

export interface CandidateInputRow {
  title: string
  url: string
  snippet: string
}

export function buildCandidateUser(
  ideaText: string,
  summary: string,
  criteria: string[],
  results: CandidateInputRow[],
): string {
  const lines = results
    .map((r, i) => `${i + 1}. ${r.title} | ${r.url} | ${r.snippet}`)
    .join('\n')
  return `Idea: "${ideaText}"
Summary: ${summary || 'n/a'}
Criteria: ${criteria.join('; ') || 'n/a'}

Search results:
${lines}

Return 3-5 candidate JSON per schema. URLs must come verbatim from the list above.`
}

export function normalizePass1(raw: unknown, allowedUrls?: Set<string>): Pass1Result {
  const obj = raw as Partial<Pass1Result>
  const allowedNorm = allowedUrls ? new Set([...allowedUrls].map(normalizeUrl)) : undefined
  const candidates = Array.isArray(obj.candidates) ? obj.candidates : []
  const cleaned = candidates
    .map((c) => ({
      title: String(c?.title ?? '').trim(),
      shop: String(c?.shop ?? '').trim(),
      url: String(c?.url ?? '').trim(),
      price: c?.price ? String(c.price).trim() : null,
      why: c?.why ? String(c.why).trim() : null,
    }))
    .filter(
      (c) =>
        c.title &&
        c.shop &&
        isHttpUrl(c.url) &&
        (!allowedNorm || allowedNorm.has(normalizeUrl(c.url))),
    )
  return {
    summary: '',
    criteria: [],
    candidates: cleaned.slice(0, 5),
    followUpQueries: [],
  }
}

// ---------------------------------------------------------------------------
// Step 3 - verify candidates against fetched page text
// ---------------------------------------------------------------------------

export const VERIFY_SYSTEM = `You are the verification pass of a shopping-research bot.
You receive a candidate shopping list plus the raw text of the top candidate
pages. Verify each candidate against the page evidence, then produce the final
ranked picks.

Ground rules:
- A pick is a PRODUCT, not a shop. If the same product is available at several
  shops in the candidate list, return it exactly ONCE, listing every known shop
  offer as its suppliers (best price first). Do not emit the same product as
  separate picks - even if its names differ slightly (e.g. "Wahoo KICKR
  Headwind Smart Fan" vs "Wahoo KICKR Headwind").
- All shop types are legitimate: big marketplaces, brand stores, specialist
  and smaller retailers. Do not exclude marketplaces; do not fill the list
  with only one shop type either.
- Keep only products supported by the page text or clearly confirmed by it.
- Each pick: concrete product title, a one-line "why this fits" grounded in
  the criteria + evidence, and a suppliers array. Each supplier: shop name,
  the candidate's real URL for that shop, price in EUR if the page/snippet
  shows one (bare number or range).
- "Shop data" lines come from the shop page's own product markup: trust them
  over snippets for price and stock. Prefer products that are in stock.
- Each pick also gets a "caveat": one short, honest trade-off or thing to
  check before buying (noise, size, compatibility, subscription, short
  warranty...), grounded in the evidence or well-known about the product.
  Leave it empty rather than invent one.
- Rank best first. Final list: 3-5 distinct products. Do not pad with guesses.
- Never invent URLs - only use the URLs provided in the candidates.
- Mention delivery/stock only if the page evidence states it.`

export const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          title: { type: 'string' },
          why: { type: 'string', description: 'One line, <=180 chars' },
          caveat: { type: 'string', description: 'One honest trade-off, <=120 chars, or empty' },
          suppliers: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                shop: { type: 'string' },
                url: { type: 'string' },
                price: { type: 'string', description: 'bare EUR number/range, or empty' },
              },
              required: ['shop', 'url', 'price'],
            },
          },
        },
        required: ['title', 'why', 'suppliers'],
      },
    },
  },
  required: ['picks'],
} as const

export interface Pass2Context {
  ideaText: string
  summary: string
  criteria: string[]
  candidates: ResearchCandidate[]
  pages: Array<{ url: string; title: string; text: string; product: ProductData | null }>
  fetchErrors: string[]
}

/** One evidence line from a page's structured product data, or ''. */
export function describeProduct(product: ProductData | null): string {
  if (!product) return ''
  const facts = [
    product.name,
    product.brand ? `brand ${product.brand}` : null,
    product.price !== null ? `price EUR ${product.price}` : null,
    product.availability !== 'unknown' ? product.availability.replace('_', ' ') : null,
    product.rating
      ? `rated ${product.rating.value}/5${product.rating.count ? ` (${product.rating.count} reviews)` : ''}`
      : null,
  ].filter(Boolean)
  return facts.length ? `Shop data: ${facts.join(', ')}\n` : ''
}

export function buildVerifyUser(ctx: Pass2Context): string {
  const cand = ctx.candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.title} | ${c.shop} | ${c.url}${c.price ? ` | EUR ${c.price}` : ''}${c.why ? ` | ${c.why}` : ''}`,
    )
    .join('\n')
  const pages = ctx.pages
    .map((p) => `--- PAGE: ${p.url} (${p.title}) ---\n${describeProduct(p.product)}${p.text}`)
    .join('\n\n')
  const errors = ctx.fetchErrors.length
    ? `\nPages that could not be fetched:\n${ctx.fetchErrors.join('\n')}\n`
    : ''

  return `Original idea: "${ctx.ideaText}"
Discovery summary: ${ctx.summary || 'n/a'}
Criteria: ${ctx.criteria.join('; ') || 'n/a'}

Candidates:
${cand}
${errors}
Page evidence:
${pages || '(no pages were fetched - fall back on candidate evidence, keep only well-supported picks)'}

Return final JSON picks per schema (rank 1..n, ascending).`
}

export function normalizePass2(raw: unknown, allowed: ResearchCandidate[]): FinalPick[] {
  const obj = raw as { picks?: Array<Record<string, unknown>> }
  const list = Array.isArray(obj.picks) ? obj.picks : []
  const allowedNormalized = new Map(allowed.map((c) => [normalizeUrl(c.url), c]))
  const result: FinalPick[] = []

  for (const p of list) {
    let title = String(p.title ?? '').trim()
    const why = String(p.why ?? '').trim()
    const caveat = String(p.caveat ?? '').trim() || null

    // Suppliers: prefer the array shape, fall back to a single flat offer.
    const suppliers: PickSupplier[] = []
    if (Array.isArray(p.suppliers)) {
      if (!title) continue
      for (const s of p.suppliers as Array<Record<string, unknown>>) {
        const shop = String(s?.shop ?? '').trim()
        const url = String(s?.url ?? '').trim()
        if (!shop || !isHttpUrl(url)) continue
        if (!allowedNormalized.has(normalizeUrl(url))) continue
        suppliers.push(offer(shop, url, s?.price))
      }
    } else {
      const url = String(p.url ?? '').trim()
      if (!isHttpUrl(url)) continue
      const match = allowedNormalized.get(normalizeUrl(url))
      if (!match) continue
      suppliers.push(
        offer(String(p.shop ?? match.shop).trim() || match.shop, match.url, p.price ?? match.price),
      )
      if (!title) title = match.title
    }

    const merged = mergeSuppliers(suppliers)
    if (merged.length === 0) continue
    result.push({
      rank: 0,
      title,
      ...primaryFields(merged),
      why,
      caveat,
      image: null,
      rating: null,
      suppliers: merged,
      sourceUrls: [],
    })
  }

  return rankPicks(mergePicksByProduct(result)).slice(0, 5)
}

/** An offer as the model or search saw it; the pipeline checks it on the shop page later. */
export function offer(shop: string, url: string, price: unknown): PickSupplier {
  return { shop, url, price: parsePriceEur(price), availability: 'unknown', checked: false }
}

