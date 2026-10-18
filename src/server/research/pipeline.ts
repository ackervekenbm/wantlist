import type { FinalPick, ResearchCandidate, ResearchEngine, ResearchRequest } from '../../types'
import { checkUrl, fetchPageText } from './http'
import {
  buildCandidateUser,
  buildQueryUser,
  buildVerifyUser,
  CANDIDATE_SCHEMA,
  CANDIDATE_SYSTEM,
  generateJson,
  GeminiError,
  mergePicksByProduct,
  mergeSuppliers,
  normalizePass1,
  normalizePass2,
  normalizePlan,
  normalizeUrl,
  QUERY_SCHEMA,
  QUERY_SYSTEM,
  rankPicks,
  VERIFY_SCHEMA,
  VERIFY_SYSTEM,
} from './gemini'
import type { CandidateInputRow, SearchProvider } from './search'

export interface GeminiEngineOptions {
  apiKey: string
  model: string
  search: SearchProvider
  maxCandidatesToFetch?: number
  onProgress?: (message: string) => void
}

const BACKOFF_BASE_MS = 3000
const MAX_TRANSIENT_RETRIES = 3

export class GeminiEngine implements ResearchEngine {
  constructor(private readonly opts: GeminiEngineOptions) {}

  async research(request: ResearchRequest): Promise<FinalPick[]> {
    const progress = this.opts.onProgress ?? (() => {})
    const run = this.withRetry.bind(this)

    progress('step 1: planning queries')
    const plan = normalizePlan(
      await run(() =>
        generateJson({
          apiKey: this.opts.apiKey,
          model: this.opts.model,
          systemInstruction: QUERY_SYSTEM,
          contents: buildQueryUser(request.text),
          schema: QUERY_SCHEMA,
          temperature: 0.4,
        }),
      ),
    )
    progress(`step 1: ${plan.searchQueries.length} query(ies)`)

    const results = await this.searchAll(plan.searchQueries, progress)
    if (results.length === 0) {
      throw new GeminiError('search returned no results', 400, false)
    }
    progress(`step 2: ${results.length} search hits`)

    const allowed = new Set(results.map((r) => normalizeUrl(r.url)))
    const rawCandidates = await run(() =>
      generateJson({
        apiKey: this.opts.apiKey,
        model: this.opts.model,
        systemInstruction: CANDIDATE_SYSTEM,
        contents: buildCandidateUser(request.text, plan.summary, plan.criteria, results),
        schema: CANDIDATE_SCHEMA,
        temperature: 0.3,
      }),
    )
    const pass1 = normalizePass1(rawCandidates, allowed)
    if (pass1.candidates.length === 0) {
      throw new GeminiError('candidate step returned no usable candidates', 200, false)
    }
    progress(`step 2: ${pass1.candidates.length} candidates`)

    const maxFetch = this.opts.maxCandidatesToFetch ?? 3
    const pages: Array<{ url: string; title: string; text: string }> = []
    const fetchErrors: string[] = []
    for (const candidate of pass1.candidates.slice(0, maxFetch)) {
      try {
        const page = await fetchPageText(candidate.url)
        pages.push({ url: candidate.url, ...page })
        progress(`step 3: fetched ${candidate.url}`)
      } catch (err) {
        fetchErrors.push(candidate.url)
        progress(`step 3: fetch failed ${candidate.url}: ${(err as Error).message}`)
      }
    }

    progress('step 4: verifying')
    const rawPicks = await run(() =>
      generateJson({
        apiKey: this.opts.apiKey,
        model: this.opts.model,
        systemInstruction: VERIFY_SYSTEM,
        contents: buildVerifyUser({
          ideaText: request.text,
          summary: plan.summary,
          criteria: plan.criteria,
          candidates: pass1.candidates,
          pages,
          fetchErrors,
        }),
        schema: VERIFY_SCHEMA,
        temperature: 0.3,
      }),
    )
    let picks = normalizePass2(rawPicks, pass1.candidates)
    if (picks.length === 0) picks = this.fallbackFromPass1(pass1.candidates)

    progress('liveness: checking links')
    picks = await this.filterLive(picks)

    return rankPicks(picks)
  }

  private async searchAll(
    queries: string[],
    progress: (msg: string) => void,
  ): Promise<CandidateInputRow[]> {
    const rows: CandidateInputRow[] = []
    const seen = new Set<string>()
    for (const q of queries) {
      try {
        const hits = await this.withRetry(() => this.opts.search.search(q))
        progress(`step 2: searched "${q}" -> ${hits.length} hits`)
        for (const h of hits) {
          const key = normalizeUrl(h.url)
          if (seen.has(key)) continue
          seen.add(key)
          rows.push({ title: h.title, url: h.url, snippet: h.snippet })
        }
      } catch (err) {
        progress(`step 2: search "${q}" failed: ${(err as Error).message}`)
      }
      if (rows.length >= 24) break
    }
    return rows
  }

  private fallbackFromPass1(candidates: ResearchCandidate[]): FinalPick[] {
    const picks: FinalPick[] = []
    for (const c of candidates) {
      picks.push({
        rank: 0,
        title: c.title,
        shop: c.shop,
        url: c.url,
        price: c.price ?? null,
        why: c.why ?? '',
        suppliers: [{ shop: c.shop, url: c.url, price: c.price ?? null }],
      })
    }
    return mergePicksByProduct(picks)
  }

  private async filterLive(picks: FinalPick[]): Promise<FinalPick[]> {
    const withStatus = await Promise.all(
      picks.map(async (p) => {
        const suppliers = await Promise.all(
          p.suppliers.map(async (s) => ({
            supplier: s,
            status: await checkUrl(s.url),
          })),
        )
        const live = suppliers.filter((s) => s.status !== 'dead').map((s) => s.supplier)
        return { pick: p, live }
      }),
    )
    // Keep picks with at least one live or unknown supplier, re-ordered best-first.
    return withStatus
      .filter((w) => w.live.length > 0)
      .map((w) => {
        const suppliers = mergeSuppliers(w.live)
        const primary = suppliers[0]
        return {
          ...w.pick,
          shop: primary.shop,
          url: primary.url,
          price: primary.price,
          suppliers,
        }
      })
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof GeminiError && err.retryable && attempt < MAX_TRANSIENT_RETRIES) {
          const base = err.retryAfterMs ?? BACKOFF_BASE_MS * 2 ** attempt
          const jitter = 0.8 + Math.random() * 0.4
          attempt += 1
          await sleep(Math.round(base * jitter))
          continue
        }
        throw err
      }
    }
  }
}

export type { SearchProvider }

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}