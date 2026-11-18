import type { PickSupplier } from '../../types'
import { ResearchError } from './errors'
import { fetchPage, type Page } from './http'
import { isListingUrl, normalizeUrl, type Exclusion } from './offers'
import type { CandidateInputRow } from './prompts'
import type { SearchProvider } from './search'

// Search and page helpers shared by the Explore pipeline and the hunt.

const BACKOFF_BASE_MS = 3000
const MAX_TRANSIENT_RETRIES = 3
const MAX_SEARCH_ROWS = 24
/** Shop pages fetched at once while checking offers. */
export const PAGE_CONCURRENCY = 6

export type Sleep = (ms: number) => Promise<void>

async function withRetry<T>(fn: () => Promise<T>, sleepFn?: Sleep): Promise<T> {
  const sleep = sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
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

/**
 * Runs every query, de-duplicating hits. One failed query is tolerated;
 * when every query fails, the most telling error is rethrown (a refused key
 * beats a flaky network), so the idea shows why instead of "no results".
 * Hits the owner already saw, and category or search pages, are dropped
 * before the row cap counts them.
 */
export async function searchAll(
  search: SearchProvider,
  queries: string[],
  progress: (msg: string) => void,
  ex: Exclusion,
  sleep?: Sleep,
): Promise<{ rows: CandidateInputRow[]; excludedAny: boolean }> {
  const rows: CandidateInputRow[] = []
  const seen = new Set<string>()
  const errors: ResearchError[] = []
  let excludedAny = false
  for (const q of queries) {
    try {
      const hits = await withRetry(() => search.search(q), sleep)
      progress(`step 2: searched "${q}" -> ${hits.length} hits`)
      for (const h of hits) {
        const key = normalizeUrl(h.url)
        if (seen.has(key) || isListingUrl(h.url)) continue
        seen.add(key)
        // By URL only: a hit's title is the page title, not a product name to compare.
        if (ex.urls.has(key)) {
          excludedAny = true
          continue
        }
        rows.push({ title: h.title, url: h.url, snippet: h.snippet })
      }
    } catch (err) {
      progress(`step 2: search "${q}" failed: ${(err as Error).message}`)
      errors.push(err instanceof ResearchError ? err : new ResearchError((err as Error).message, { kind: 'transient' }))
      if (errors.at(-1)?.kind === 'unavailable') break
    }
    if (rows.length >= MAX_SEARCH_ROWS) break
  }
  if (rows.length > 0 || excludedAny) return { rows, excludedAny }
  if (errors.length > 0) throw errors.find((e) => e.kind === 'unavailable') ?? errors[errors.length - 1]
  throw new ResearchError('The searches found nothing to buy. Try describing the idea differently.', {
    kind: 'no-results',
  })
}

/** Each URL is fetched at most once per research run. */
export class PageCache {
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
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
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

/**
 * The offer with price and stock from the shop page's own product data; null
 * when the page is dead or is a category, search or article page.
 */
export function checkedSupplier(s: PickSupplier, page: Page): PickSupplier | null {
  if (page.status === 'dead' || page.kind) return null
  const product = page.product
  if (!product) return s
  return {
    ...s,
    price: product.price ?? s.price,
    availability: product.availability,
    checked: product.price !== null || product.availability !== 'unknown',
  }
}
