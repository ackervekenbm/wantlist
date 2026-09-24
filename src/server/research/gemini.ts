import type { FinalPick, Pass1Result, ResearchCandidate } from '../../types'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message)
    this.name = 'GeminiError'
  }
}

export interface GenerateArgs {
  apiKey: string
  model: string
  systemInstruction: string
  contents: string
  schema: object
  temperature?: number
}

export async function generateJson(args: GenerateArgs): Promise<unknown> {
  const url = `${BASE}/models/${args.model}:generateContent?key=${encodeURIComponent(args.apiKey)}`
  const body = {
    systemInstruction: { parts: [{ text: args.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: args.contents }] }],
    generationConfig: {
      temperature: args.temperature ?? 0.4,
      responseMimeType: 'application/json',
      responseSchema: args.schema,
    },
    tools: [{ google_search: {} }],
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (res.status === 429 || res.status === 503) {
    const retryAfter = res.headers.get('Retry-After')
    throw new GeminiError(
      `Gemini rate limited (HTTP ${res.status})`,
      res.status,
      true,
      retryAfter ? Number.parseInt(retryAfter, 10) * 1000 : null,
    )
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300)
    throw new GeminiError(`Gemini HTTP ${res.status}: ${detail}`, res.status, false)
  }

  const json = (await res.json()) as GeminiResponse
  const candidate = json.candidates?.[0]
  const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('')
  if (!text) {
    throw new GeminiError('Gemini returned no candidate text', 400, false)
  }
  if (candidate?.finishReason === 'SAFETY' || candidate?.finishReason === 'RECITATION') {
    throw new GeminiError(`Gemini blocked (${candidate.finishReason})`, 200, false)
  }
  return parseJsonLoose(text)
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
    throw new GeminiError('Gemini returned unparseable JSON', 400, false)
  }
}

// ---------------------------------------------------------------------------
// Pass 1 - discovery
// ---------------------------------------------------------------------------

export const PASS1_SYSTEM = `You are the discovery pass of a deferred shopping researcher.
The user describes a vague buying idea in plain words. Your job: figure out what
they actually need and find candidate products they could buy in Belgium.

Ground rules:
- Country is Belgium. Prices in EUR. Any shop you recommend must be able to
  deliver to Belgium (Belgian retailers, EU retailers, or shops with explicit
  BE shipping).
- The user wants depth beyond the obvious big marketplaces. Prefer specialist
  retailers, brand stores, independent shops, refurbished outlets, maker
  marketplaces - anything relevant and buyable. Big shops (bol.com, Coolblue,
  Amazon, MediaMarkt) may appear, but do not fill the list with them.
- Be honest about what the product is. If the idea is ambiguous, resolve it
  from context (e.g. an indoor cycling fan means a low-speed-tolerant,
  quiet, high-airflow standing or clamp fan, not a ceiling fan).
- Each candidate needs a real, specific product page URL you have actually
  retrieved or seen in grounding sources - no invented links, no bare homepages.
- Prices are ballpark EUR from current sources. If unsure, leave price empty.
- 3 to 5 candidates total, best first. Follow-up queries: 0-2 extra search
  phrases you would run next if you could keep researching.`

const PASS1_SCHEMA = {
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
    followUpQueries: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['summary', 'criteria', 'candidates'],
} as const

export function buildPass1User(ideaText: string): string {
  return `Idea to research:\n"${ideaText}"\n\nReturn discovery JSON per schema.`
}

export function normalizePass1(raw: unknown): Pass1Result {
  const obj = raw as Partial<Pass1Result>
  const candidates = Array.isArray(obj.candidates) ? obj.candidates : []
  const cleaned = candidates
    .map((c) => ({
      title: String(c?.title ?? '').trim(),
      shop: String(c?.shop ?? '').trim(),
      url: String(c?.url ?? '').trim(),
      price: c?.price ? String(c.price).trim() : null,
      why: c?.why ? String(c.why).trim() : null,
    }))
    .filter((c) => c.title && c.shop && isHttpUrl(c.url))
  return {
    summary: String(obj.summary ?? '').trim(),
    criteria: Array.isArray(obj.criteria) ? obj.criteria.map(String) : [],
    candidates: cleaned.slice(0, 5),
    followUpQueries: Array.isArray(obj.followUpQueries)
      ? obj.followUpQueries.map(String)
      : [],
  }
}

// ---------------------------------------------------------------------------
// Pass 2 - verification / synthesis
// ---------------------------------------------------------------------------

export const PASS2_SYSTEM = `You are the verification pass of a deferred shopping researcher.
You receive a candidate shopping list plus the raw text of the top candidate
pages. Verify each candidate against the page evidence, then produce the final
ranked picks.

Ground rules:
- Keep only candidates supported by the page text or clearly confirmed by it.
- Each pick: concrete title, shop name, full product URL (the candidate's URL),
  price ballpark in EUR if the page shows one, and a one-line "why this fits"
  grounded in the criteria and evidence.
- Favor the most complete answer to the user's idea. Rank best first.
- Final list: 3-5 picks. If the evidence does not support enough, return what
  you can stand behind rather than padding with guesses.
- Never invent URLs - only use the URLs provided in the candidates.`

const PASS2_SCHEMA = {
  type: 'object',
  properties: {
    picks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          rank: { type: 'integer' },
          title: { type: 'string' },
          shop: { type: 'string' },
          url: { type: 'string' },
          price: { type: 'string' },
          why: { type: 'string' },
        },
        required: ['title', 'shop', 'url', 'why'],
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

export function buildPass2User(ctx: Pass2Context): string {
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
  const obj = raw as { picks?: Array<Partial<FinalPick>> }
  const list = Array.isArray(obj.picks) ? obj.picks : []
  const seen = new Set<string>()
  const result: FinalPick[] = []

  for (const p of list) {
    const url = String(p.url ?? '').trim()
    if (!isHttpUrl(url)) continue
    const match = allowed.find((c) => normalizeUrl(c.url) === normalizeUrl(url))
    if (!match) continue
    const key = normalizeUrl(url)
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      rank: result.length + 1,
      title: String(p.title ?? match.title).trim() || match.title,
      shop: String(p.shop ?? match.shop).trim() || match.shop,
      url: match.url,
      price: p.price
        ? String(p.price).trim()
        : match.price ?? null,
      why: String(p.why ?? match.why ?? '').trim(),
    })
  }
  return result.slice(0, 5)
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

export { PASS1_SCHEMA, PASS2_SCHEMA }