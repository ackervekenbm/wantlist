import type {
  FinalPick,
  HistoryPick,
  Pass1Result,
  PickSupplier,
  Preferences,
  ResearchCandidate,
  ResearchHistory,
  ResearchRequest,
} from '../../types'
import { PREF_ITEM_CHARS, PREF_ITEMS_MAX, PREF_SUMMARY_CHARS, TITLE_MAX } from '../../types/limits'
import { ResearchError } from './errors'
import { isHttpUrl, mergePicksByProduct, mergeSuppliers, normalizeUrl, primaryFields, rankPicks } from './offers'
import { parsePriceEur, type ProductData } from './product'

// Prompts, response schemas, user-message builders and normalizers for the
// three model steps. Normalizers are the safety net: they drop anything the
// evidence does not back (URLs outside the allowed set in particular), and
// throw an `invalid` ResearchError when nothing usable is left, so the router
// tries the next model instead of failing the idea.

/** What the user asked for, as every step sees it. */
export type IdeaInput = Pick<ResearchRequest, 'text' | 'budget' | 'notes'>

/** The idea plus the user's budget and notes, one fact per line. */
export function describeIdea(idea: IdeaInput): string {
  return [
    `Idea: "${idea.text}"`,
    idea.budget ? `Budget: at most EUR ${idea.budget}` : null,
    idea.notes ? `User notes (must-haves, constraints): ${idea.notes}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

const BUDGET_RULE = `- When a budget is given, it is a ceiling: prefer products at or under it.
  At most one pick may go up to ~15% over, only when it is clearly better,
  and its "why" must say so.
- User notes are hard requirements unless they say otherwise.`

// ---------------------------------------------------------------------------
// Preferences and earlier picks, as every step sees them
// ---------------------------------------------------------------------------

/** How many earlier picks a prompt shows; code-level exclusion still uses all of them. */
const SHOWN_MAX = 40

function capList(raw: unknown): string[] {
  return (Array.isArray(raw) ? raw : [])
    .map((s) => String(s ?? '').trim().slice(0, PREF_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, PREF_ITEMS_MAX)
}

/** Coerces untrusted preferences (model output or a request body) to the limits. Never throws. */
export function capPreferences(raw: unknown): Preferences {
  const obj = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return {
    summary: String(obj.summary ?? '').trim().slice(0, PREF_SUMMARY_CHARS),
    mustHaves: capList(obj.mustHaves),
    avoid: capList(obj.avoid),
    likes: capList(obj.likes),
  }
}

/** The learned preferences with every owner item kept word-for-word, owner items first. */
export function keepOwnerItems(learned: Preferences, owner: Preferences): Preferences {
  const merge = (own: string[], got: string[]) => [...own, ...got.filter((s) => !own.includes(s))]
  return capPreferences({
    summary: owner.summary || learned.summary,
    mustHaves: merge(owner.mustHaves, learned.mustHaves),
    avoid: merge(owner.avoid, learned.avoid),
    likes: merge(owner.likes, learned.likes),
  })
}

export function describePreferences(p: Preferences): string {
  return [
    p.summary ? `What it is: ${p.summary}` : null,
    p.mustHaves.length ? `Must have: ${p.mustHaves.join('; ')}` : null,
    p.avoid.length ? `Avoid: ${p.avoid.join('; ')}` : null,
    p.likes.length ? `Liked so far: ${p.likes.join('; ')}` : null,
  ]
    .filter(Boolean)
    .join('\n')
}

/** The newest picks a prompt lists; `repeatOf` numbers refer to this list. */
export function shownForPrompt(picks: HistoryPick[]): HistoryPick[] {
  return [...picks].sort((a, b) => b.round - a.round).slice(0, SHOWN_MAX)
}

export function describeShown(shown: HistoryPick[]): string {
  return shown.map((p, i) => `${i + 1}. ${p.title}${p.shop ? ` | ${p.shop}` : ''}`).join('\n')
}

function cleanQueries(raw: unknown, what: string): string[] {
  const queries = (Array.isArray(raw) ? raw : [])
    .map((q) => String(q).trim())
    .filter(Boolean)
    .slice(0, 4)
  if (queries.length === 0) {
    throw new ResearchError(`${what} has no search queries`, { kind: 'invalid' })
  }
  return queries
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
- Keep queries specific enough to return product pages, not category homepages.
- When a budget is given, steer queries toward that price range; fold the
  user's notes into the queries and the criteria.
- Give it a title: a short, specific English name for what is being looked
  for (e.g. "Quiet fan for indoor cycling"), at most 60 characters.`

export const QUERY_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short, specific name for what is being looked for, ≤ 60 chars, English',
    },
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
  required: ['title', 'summary', 'criteria', 'searchQueries'],
} as const

export interface ResearchPlan {
  title: string
  summary: string
  criteria: string[]
  searchQueries: string[]
}

export function buildQueryUser(idea: IdeaInput): string {
  return `${describeIdea(idea)}\n\nReturn the research plan JSON per schema.`
}

export function normalizePlan(raw: unknown): ResearchPlan {
  const obj = raw as Partial<ResearchPlan>
  const queries = cleanQueries(obj.searchQueries, 'plan')
  return {
    title: String(obj.title ?? '').trim().slice(0, TITLE_MAX),
    summary: String(obj.summary ?? '').trim(),
    criteria: Array.isArray(obj.criteria) ? obj.criteria.map(String).filter(Boolean) : [],
    searchQueries: queries,
  }
}

// ---------------------------------------------------------------------------
// Step 1b - learn from the owner's reactions (replaces the plan in later rounds)
// ---------------------------------------------------------------------------

export const LEARN_SYSTEM = `You are the learn step of a shopping-research bot that has NO internet access itself.
The owner already saw earlier rounds of picks and reacted to some of them
(no / maybe / yes, sometimes with a reason). Update what they want, then
produce web-search queries for a NEW round that finds what is still missing.

Preferences:
- Keep criteria that still hold; drop or reword only what the reactions contradict.
- Turn every reason on a "no" pick (and the negative part of a "maybe" reason)
  into a concrete, searchable "avoid" (or "mustHaves") item that names the
  trait, not the product. Example: "looks like grandma's" becomes
  "no floral or quilted granny styles"; "too loud" becomes "quiet, under 40 dB".
  Never just echo the reason.
- A "no" without a reason: infer the trait only when it is obvious, else skip it.
- Turn "yes" and "maybe" picks, and the positive part of their reasons, into
  "likes" as traits (style, material, size, feature), never product names,
  brands or shops. They do not become "mustHaves".
- Items marked as set by the owner must stay word-for-word in their list.
- "summary": one sentence on what the owner is really after now.
- Title: keep the current title unless the reactions justify a sharper one;
  short, specific, English, at most 60 characters.

Queries:
- 1 to 4 real search queries, in English, that a search engine can answer.
- Aim them at what is missing: the must-haves and likes, steered away from the
  avoid items. Phrase them so they do not resurface the rejected products
  (no rejected product names or model numbers).
- Country Belgium, prices EUR. Cover the whole market, not only big marketplaces.
- Keep queries specific enough to return product pages, not category homepages.
${BUDGET_RULE}`

export const LEARN_SCHEMA = {
  type: 'object',
  properties: {
    title: {
      type: 'string',
      description: 'Short, specific name for what is being looked for, ≤ 60 chars, English',
    },
    preferences: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'One sentence on what the owner is really after' },
        mustHaves: { type: 'array', items: { type: 'string' }, description: 'Hard requirements' },
        avoid: { type: 'array', items: { type: 'string' }, description: 'Concrete traits to avoid' },
        likes: { type: 'array', items: { type: 'string' }, description: 'Liked traits, never product names' },
      },
      required: ['summary', 'mustHaves', 'avoid', 'likes'],
    },
    searchQueries: {
      type: 'array',
      items: { type: 'string' },
      description: '1-4 real search queries',
    },
  },
  required: ['title', 'preferences', 'searchQueries'],
} as const

function describeHistoryPick(p: HistoryPick): string {
  const price = p.price !== null ? ` | EUR ${p.price}` : ''
  const reaction = p.reaction
    ? ` · reaction: ${p.reaction}${p.reason ? ` — "${p.reason.replace(/\s+/g, ' ').trim()}"` : ''}`
    : ' · no reaction'
  return `round ${p.round} · ${p.title}${p.shop ? ` | ${p.shop}` : ''}${price}${reaction}`
}

export function buildLearnUser(idea: IdeaInput, title: string | null, history: ResearchHistory): string {
  const prefs = history.preferences
  const heading = history.preferencesEdited
    ? 'Current preferences (set by the owner — keep every item word-for-word):'
    : 'Current preferences:'
  // Reacted picks first so an old reaction is never cut by the cap.
  const byRound = [...history.picks].sort((a, b) => b.round - a.round)
  const ordered = [...byRound.filter((p) => p.reaction), ...byRound.filter((p) => !p.reaction)]
  const lines = ordered.slice(0, SHOWN_MAX).map(describeHistoryPick).join('\n')
  return `${describeIdea(idea)}
Current title: ${title || 'n/a'}

${heading}
${(prefs && describePreferences(prefs)) || 'n/a'}

Earlier picks and the owner's reactions (reacted first, newest first):
${lines || 'n/a'}

Return the updated title, preferences and search queries JSON per schema.`
}

export function normalizeLearn(raw: unknown): { title: string; preferences: Preferences; searchQueries: string[] } {
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    title: String(obj.title ?? '').trim().slice(0, TITLE_MAX),
    preferences: capPreferences(obj.preferences),
    searchQueries: cleanQueries(obj.searchQueries, 'learn step'),
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
- Prefer product pages over category/home/aggregator pages.
- Respect every "Must have" and "Avoid" line; prefer products with the
  "Liked so far" traits.
${BUDGET_RULE}`

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
  idea: IdeaInput,
  preferences: Preferences,
  results: CandidateInputRow[],
  shown: HistoryPick[],
): string {
  const lines = results
    .map((r, i) => `${i + 1}. ${r.title} | ${r.url} | ${r.snippet}`)
    .join('\n')
  const already = shown.length
    ? `\nAlready shown — never pick these again, at any shop:\n${describeShown(shown)}\n`
    : ''
  return `${describeIdea(idea)}
${describePreferences(preferences)}
${already}
Search results:
${lines}

Return 3-5 candidate JSON per schema. URLs must come verbatim from the list above.`
}

export function normalizePass1(
  raw: unknown,
  allowedUrls?: Set<string>,
  exclude?: (c: ResearchCandidate) => boolean,
): Pass1Result {
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
        (!allowedNorm || allowedNorm.has(normalizeUrl(c.url))) &&
        !exclude?.(c),
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
- Respect every "Must have" and "Avoid" line; prefer products with the
  "Liked so far" traits.
- Each pick: concrete product title, a one-line "why this fits" grounded in
  the owner's preferences + evidence, and a suppliers array. Each supplier: shop name,
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
- Mention delivery/stock only if the page evidence states it.
${BUDGET_RULE}`

export function verifySchema(withRepeat: boolean) {
  return {
    type: 'object',
    properties: {
      picks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            ...(withRepeat
              ? {
                  repeatOf: {
                    type: 'integer',
                    description: 'number of the already-shown product this is the same model as, or 0',
                  },
                }
              : {}),
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
          required: withRepeat ? ['title', 'why', 'suppliers', 'repeatOf'] : ['title', 'why', 'suppliers'],
        },
      },
    },
    required: ['picks'],
  } as const
}

export interface Pass2Context {
  idea: IdeaInput
  preferences: Preferences
  /** The capped list from shownForPrompt; repeatOf numbers refer to it. */
  shown: HistoryPick[]
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

  const shown = ctx.shown.length
    ? `
Already shown to the owner in earlier rounds:
${describeShown(ctx.shown)}

Rule: these must not come back. For every pick, set "repeatOf" to the number of
the already-shown product it is the same model as (any shop, any colour or
storage variant counts as the same model), or 0 when it is genuinely new.
`
    : ''
  return `${describeIdea(ctx.idea)}
${describePreferences(ctx.preferences)}
${shown}
Candidates:
${cand}
${errors}
Page evidence:
${pages || '(no pages were fetched - fall back on candidate evidence, keep only well-supported picks)'}

Return final JSON picks per schema (rank 1..n, ascending).`
}

export function normalizePass2(
  raw: unknown,
  allowed: ResearchCandidate[],
  shownCount: number,
): { picks: FinalPick[]; repeats: number } {
  const obj = raw as { picks?: Array<Record<string, unknown>> }
  const list = Array.isArray(obj.picks) ? obj.picks : []
  const allowedNormalized = new Map(allowed.map((c) => [normalizeUrl(c.url), c]))
  const result: FinalPick[] = []
  let repeats = 0

  for (const p of list) {
    const repeatOf = p.repeatOf
    if (Number.isInteger(repeatOf) && (repeatOf as number) >= 1 && (repeatOf as number) <= shownCount) {
      repeats++
      continue
    }
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

  return { picks: rankPicks(mergePicksByProduct(result)).slice(0, 5), repeats }
}

/** An offer as the model or search saw it; the pipeline checks it on the shop page later. */
export function offer(shop: string, url: string, price: unknown): PickSupplier {
  return { shop, url, price: parsePriceEur(price), availability: 'unknown', checked: false }
}

