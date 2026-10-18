import type { FinalPick, Pass1Result, PickSupplier, ResearchCandidate } from '../../types'
import { ModelError, type GenerateArgs, type LlmProvider } from './llm'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiProvider implements LlmProvider {
  readonly id: string

  constructor(private readonly opts: { apiKey: string; model: string }) {
    this.id = `gemini:${opts.model}`
  }

  async generate(args: GenerateArgs): Promise<unknown> {
    const url = `${BASE}/models/${this.opts.model}:generateContent?key=${encodeURIComponent(this.opts.apiKey)}`
    const body = {
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: args.contents }] }],
      generationConfig: {
        temperature: args.temperature ?? 0.3,
        responseMimeType: 'application/json',
        responseSchema: args.schema,
      },
    }

    let res: Response
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), 90_000)
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      // Network-level flake (DNS, reset, timeout) - retryable.
      throw new ModelError(`Gemini fetch failed: ${(err as Error).message}`, 0, true)
    }

    if (res.status === 429 || res.status === 503) {
      const retryAfter = res.headers.get('Retry-After')
      const retryAfterMs = retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : null
      const detail = (await res.text()).slice(0, 300)
      if (res.status === 429) {
        // Free-tier 429s are daily request quota: no (or a very long) Retry-After.
        // Memoize as exhausted so the router advances instead of backing off.
        const quotaExhausted = retryAfterMs === null || retryAfterMs > 60_000
        const hint = quotaExhausted
          ? '\n(hint: free-tier daily request quota may be exhausted - spikes and limits move; see https://ai.dev/rate-limit)'
          : ''
        throw new ModelError(
          `Gemini rate limited (HTTP 429)${detail ? `: ${detail}` : ''}${hint}`,
          429,
          true,
          retryAfterMs,
          quotaExhausted,
        )
      }
      throw new ModelError(
        `Gemini unavailable (HTTP 503)${detail ? `: ${detail}` : ''}`,
        503,
        true,
        retryAfterMs,
      )
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      throw new ModelError(`Gemini HTTP ${res.status}: ${detail}`, res.status, false)
    }

    const json = (await res.json()) as GeminiResponse
    const candidate = json.candidates?.[0]
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) {
      throw new ModelError('Gemini returned no candidate text', 400, false)
    }
    if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
      throw new ModelError(`Gemini blocked (${candidate.finishReason})`, 200, false)
    }
    return parseJsonLoose(text)
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
}

export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(trimmed)
    if (fence?.[1]) {
      try {
        return JSON.parse(fence[1])
      } catch {
        /* fall through */
      }
    }
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start !== -1 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1))
    }
    throw new ModelError('Gemini returned unparseable JSON', 400, false)
  }
}

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

const QUERY_SCHEMA = {
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
    throw new ModelError('Gemini returned no search queries', 400, false)
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

const CANDIDATE_SCHEMA = {
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
- Rank best first. Final list: 3-5 distinct products. Do not pad with guesses.
- Never invent URLs - only use the URLs provided in the candidates.
- Mention delivery/stock only if the page evidence states it.`

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          title: { type: 'string' },
          why: { type: 'string' },
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
  pages: Array<{ url: string; title: string; text: string }>
  fetchErrors: string[]
}

export function buildVerifyUser(ctx: Pass2Context): string {
  const cand = ctx.candidates
    .map(
      (c, i) =>
        `${i + 1}. ${c.title} | ${c.shop} | ${c.url}${c.price ? ` | EUR ${c.price}` : ''}${c.why ? ` | ${c.why}` : ''}`,
    )
    .join('\n')
  const pages = ctx.pages
    .map((p) => `--- PAGE: ${p.url} (${p.title}) ---\n${p.text}`)
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

    // Suppliers: prefer the array shape, fall back to a single flat offer.
    const suppliers: PickSupplier[] = []
    if (Array.isArray(p.suppliers)) {
      if (!title) continue
      for (const s of p.suppliers as Array<Record<string, unknown>>) {
        const shop = String(s?.shop ?? '').trim()
        const url = String(s?.url ?? '').trim()
        if (!shop || !isHttpUrl(url)) continue
        if (!allowedNormalized.has(normalizeUrl(url))) continue
        suppliers.push({ shop, url, price: s?.price !== undefined ? String(s.price).trim() || null : null })
      }
    } else {
      const url = String(p.url ?? '').trim()
      if (!isHttpUrl(url)) continue
      const match = allowedNormalized.get(normalizeUrl(url))
      if (!match) continue
      suppliers.push({
        shop: String(p.shop ?? match.shop).trim() || match.shop,
        url: match.url,
        price: p.price !== undefined ? String(p.price).trim() || null : match.price ?? null,
      })
      if (!title) title = match.title
    }

    const merged = mergeSuppliers(suppliers)
    if (merged.length === 0) continue
    const primary = merged[0]
    result.push({
      rank: 0,
      title,
      shop: primary.shop,
      url: primary.url,
      price: primary.price,
      why,
      suppliers: merged,
    })
  }

  return rankPicks(mergePicksByProduct(result)).slice(0, 5)
}

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

export { CANDIDATE_SCHEMA, QUERY_SCHEMA, VERIFY_SCHEMA }