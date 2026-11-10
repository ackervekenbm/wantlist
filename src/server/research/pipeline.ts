import type {
  FinalPick,
  PickSupplier,
  ResearchCandidate,
  ResearchEngine,
  ResearchRequest,
  ResearchResult,
} from '../../types'
import { ResearchError } from './errors'
import { fetchPage, type Page } from './http'
import type { ModelRouter } from './llm'
import { mergePicksByProduct, mergeSuppliers, normalizeUrl, primaryFields, rankPicks } from './offers'
import {
  buildCandidateUser,
  buildQueryUser,
  buildVerifyUser,
  CANDIDATE_SCHEMA,
  CANDIDATE_SYSTEM,
  normalizePass1,
  normalizePass2,
  normalizePlan,
  offer,
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
/** Shop pages fetched at once while checking offers. */
const PAGE_CONCURRENCY = 6

export class PipelineEngine implements ResearchEngine {
  constructor(private readonly opts: PipelineEngineOptions) {}

  async research(request: ResearchRequest): Promise<ResearchResult> {
    const log = this.opts.onProgress ?? (() => {})
    const progress = (msg: string) => log(`#${request.ideaId} ${msg}`)
    const step = request.onProgress ?? (() => {})
    const router = this.opts.router

    step('working out what to look for')
    progress('step 1: planning queries')
    const plan = await router.generate(
      {
        systemInstruction: QUERY_SYSTEM,
        contents: buildQueryUser(request),
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
        contents: buildCandidateUser(request, plan.summary, plan.criteria, results),
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
    const pageCache = new PageCache()
    const maxFetch = this.opts.maxCandidatesToFetch ?? 3
    const toRead = pass1.candidates.slice(0, maxFetch).map((c) => c.url)
    const read = await mapLimit(toRead, PAGE_CONCURRENCY, async (url) => ({ url, page: await pageCache.get(url) }))
    const pages = read
      .filter((r) => r.page.text)
      .map((r) => ({ url: r.url, title: r.page.title, text: r.page.text, product: r.page.product }))
    const fetchErrors = read.filter((r) => !r.page.text).map((r) => r.url)
    progress(`step 3: read ${pages.length}/${read.length} pages`)

    step('checking the evidence')
    progress('step 4: verifying')
    let picks = await router.generate(
      {
        systemInstruction: VERIFY_SYSTEM,
        contents: buildVerifyUser({
          idea: request,
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

    step(`checking ${picks.reduce((n, p) => n + p.suppliers.length, 0)} offers at the shops`)
    progress('step 5: checking offers')
    picks = await this.checkOffers(picks, pageCache)
    const sourceUrls = pages.map((p) => p.url)

    return {
      brief: { summary: plan.summary, criteria: plan.criteria },
      picks: rankPicks(picks.map((p) => ({ ...p, sourceUrls }))),
    }
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
      candidates.map((c) => {
        const suppliers = [offer(c.shop, c.url, c.price)]
        return {
          rank: 0,
          title: c.title,
          ...primaryFields(suppliers),
          why: c.why ?? '',
          caveat: null,
          image: null,
          rating: null,
          suppliers,
          sourceUrls: [],
        }
      }),
    )
  }

  /**
   * Opens every offer's page once (pages already read for verification are
   * reused): dead links are dropped, and price, stock, photo and rating come
   * from the shop's own product data when it has some. A pick with no live
   * offer left is dropped; picks that are out of stock everywhere sink to the
   * end, otherwise the model's order stands.
   */
  private async checkOffers(picks: FinalPick[], cache: PageCache): Promise<FinalPick[]> {
    const urls = [...new Set(picks.flatMap((p) => p.suppliers.map((s) => s.url)))]
    await mapLimit(urls, PAGE_CONCURRENCY, (url) => cache.get(url))

    const checked: FinalPick[] = []
    for (const pick of picks) {
      const offers: PickSupplier[] = []
      let image = pick.image
      let rating = pick.rating
      for (const s of pick.suppliers) {
        const page = await cache.get(s.url)
        if (page.status === 'dead') continue
        const product = page.product
        if (!product) {
          offers.push(s)
          continue
        }
        offers.push({
          ...s,
          price: product.price ?? s.price,
          availability: product.availability,
          checked: product.price !== null || product.availability !== 'unknown',
        })
        image ??= product.image
        rating ??= product.rating
      }
      if (offers.length === 0) continue
      const suppliers = mergeSuppliers(offers)
      checked.push({ ...pick, ...primaryFields(suppliers), suppliers, image, rating })
    }
    const soldOut = (p: FinalPick) => p.suppliers.every((s) => s.availability === 'out_of_stock')
    return [...checked.filter((p) => !soldOut(p)), ...checked.filter(soldOut)]
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

/** Each URL is fetched at most once per research run. */
class PageCache {
  private readonly pages = new Map<string, Promise<Page>>()

  get(url: string): Promise<Page> {
    const key = normalizeUrl(url)
    let page = this.pages.get(key)
    if (!page) {
      page = fetchPage(url)
      this.pages.set(key, page)
    }
    return page
  }
}

/** Promise.all with at most `limit` tasks in flight, results in input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}
