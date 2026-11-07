import type { FinalPick, ResearchCandidate, ResearchEngine, ResearchRequest } from '../../types'
import { ResearchError } from './errors'
import { checkUrl, fetchPageText } from './http'
import type { ModelRouter } from './llm'
import { mergePicksByProduct, mergeSuppliers, normalizeUrl, rankPicks } from './offers'
import {
  buildCandidateUser,
  buildQueryUser,
  buildVerifyUser,
  CANDIDATE_SCHEMA,
  CANDIDATE_SYSTEM,
  normalizePass1,
  normalizePass2,
  normalizePlan,
  QUERY_SCHEMA,
  QUERY_SYSTEM,
  VERIFY_SCHEMA,
  VERIFY_SYSTEM,
  type CandidateInputRow,
} from './prompts'
import type { SearchProvider } from './search'

export interface PipelineEngineOptions {
  router: ModelRouter
  search: SearchProvider
  maxCandidatesToFetch?: number
  onProgress?: (message: string) => void
  /** Injectable sleep for tests (search retries). */
  sleep?: (ms: number) => Promise<void>
}

const BACKOFF_BASE_MS = 3000
const MAX_TRANSIENT_RETRIES = 3
const MAX_SEARCH_ROWS = 24

export class PipelineEngine implements ResearchEngine {
  constructor(private readonly opts: PipelineEngineOptions) {}

  async research(request: ResearchRequest): Promise<FinalPick[]> {
    const log = this.opts.onProgress ?? (() => {})
    const progress = (msg: string) => log(`#${request.ideaId} ${msg}`)
    const step = request.onProgress ?? (() => {})
    const router = this.opts.router

    step('working out what to look for')
    progress('step 1: planning queries')
    const plan = await router.generate(
      {
        systemInstruction: QUERY_SYSTEM,
        contents: buildQueryUser(request.text),
        schema: QUERY_SCHEMA,
        temperature: 0.4,
      },
      normalizePlan,
    )
    progress(`step 1: ${plan.searchQueries.length} query(ies)`)

    step('searching shops and reviews')
    const results = await this.searchAll(plan.searchQueries, progress)
    progress(`step 2: ${results.length} search hits`)

    step(`shortlisting from ${results.length} results`)
    const allowed = new Set(results.map((r) => normalizeUrl(r.url)))
    const pass1 = await router.generate(
      {
        systemInstruction: CANDIDATE_SYSTEM,
        contents: buildCandidateUser(request.text, plan.summary, plan.criteria, results),
        schema: CANDIDATE_SCHEMA,
        temperature: 0.3,
      },
      (raw) => {
        const parsed = normalizePass1(raw, allowed)
        if (parsed.candidates.length === 0) {
          throw new ResearchError('no candidate used a URL from the search results', { kind: 'invalid' })
        }
        return parsed
      },
    )
    progress(`step 2: ${pass1.candidates.length} candidates`)

    step(`reading ${pass1.candidates.length} product pages`)
    const maxFetch = this.opts.maxCandidatesToFetch ?? 3
    const pages: Array<{ url: string; title: string; text: string }> = []
    const fetchErrors: string[] = []
    const fetched = await Promise.all(
      pass1.candidates.slice(0, maxFetch).map(async (candidate) => {
        try {
          return { url: candidate.url, page: await fetchPageText(candidate.url) }
        } catch (err) {
          progress(`step 3: fetch failed ${candidate.url}: ${(err as Error).message}`)
          return { url: candidate.url, page: null }
        }
      }),
    )
    for (const f of fetched) {
      if (f.page) pages.push({ url: f.url, ...f.page })
      else fetchErrors.push(f.url)
    }
    progress(`step 3: read ${pages.length}/${fetched.length} pages`)

    step('checking the evidence')
    progress('step 4: verifying')
    let picks = await router.generate(
      {
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
      },
      (raw) => normalizePass2(raw, pass1.candidates),
    )
    if (picks.length === 0) picks = this.fallbackFromPass1(pass1.candidates)

    step('checking the shop links')
    progress('liveness: checking links')
    picks = await this.filterLive(picks)

    return rankPicks(picks)
  }

  /**
   * Runs every query, de-duplicating hits. One failed query is tolerated;
   * when every query fails, the most telling error is rethrown (a refused key
   * beats a flaky network), so the idea shows why instead of "no results".
   */
  private async searchAll(
    queries: string[],
    progress: (msg: string) => void,
  ): Promise<CandidateInputRow[]> {
    const rows: CandidateInputRow[] = []
    const seen = new Set<string>()
    const errors: ResearchError[] = []
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
        errors.push(
          err instanceof ResearchError ? err : new ResearchError((err as Error).message, { kind: 'transient' }),
        )
        if (errors.at(-1)?.kind === 'unavailable') break
      }
      if (rows.length >= MAX_SEARCH_ROWS) break
    }
    if (rows.length > 0) return rows
    if (errors.length > 0) throw errors.find((e) => e.kind === 'unavailable') ?? errors[errors.length - 1]
    throw new ResearchError('The searches found nothing to buy. Try describing the idea differently.', {
      kind: 'no-results',
    })
  }

  private fallbackFromPass1(candidates: ResearchCandidate[]): FinalPick[] {
    return mergePicksByProduct(
      candidates.map((c) => ({
        rank: 0,
        title: c.title,
        shop: c.shop,
        url: c.url,
        price: c.price ?? null,
        why: c.why ?? '',
        suppliers: [{ shop: c.shop, url: c.url, price: c.price ?? null }],
      })),
    )
  }

  private async filterLive(picks: FinalPick[]): Promise<FinalPick[]> {
    const withStatus = await Promise.all(
      picks.map(async (p) => {
        const suppliers = await Promise.all(
          p.suppliers.map(async (s) => ({ supplier: s, status: await checkUrl(s.url) })),
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
        return { ...w.pick, shop: primary.shop, url: primary.url, price: primary.price, suppliers }
      })
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    const sleep = this.opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof ResearchError && err.kind === 'transient' && attempt < MAX_TRANSIENT_RETRIES) {
          const base = err.retryAfterMs ?? BACKOFF_BASE_MS * 2 ** attempt
          await sleep(Math.round(base * (0.8 + Math.random() * 0.4)))
          continue
        }
        throw err
      }
    }
  }
}
