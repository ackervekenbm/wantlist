import type { FinalPick, ResearchCandidate, ResearchEngine, ResearchRequest } from '../../types'
import { checkUrl, fetchPageText } from './http'
import {
  buildPass1User,
  buildPass2User,
  generateJson,
  GeminiError,
  normalizePass1,
  normalizePass2,
  PASS1_SCHEMA,
  PASS1_SYSTEM,
  PASS2_SCHEMA,
  PASS2_SYSTEM,
} from './gemini'

export interface GeminiEngineOptions {
  apiKey: string
  model: string
  maxCandidatesToFetch?: number
  onProgress?: (message: string) => void
}

const BACKOFF_BASE_MS = 1500
const MAX_429_RETRIES = 3

export class GeminiEngine implements ResearchEngine {
  constructor(private readonly opts: GeminiEngineOptions) {}

  async research(request: ResearchRequest): Promise<FinalPick[]> {
    const progress = this.opts.onProgress ?? (() => {})
    progress(`pass 1: discovering candidates`)
    const pass1Raw = await this.withRetry(() =>
      generateJson({
        apiKey: this.opts.apiKey,
        model: this.opts.model,
        systemInstruction: PASS1_SYSTEM,
        contents: buildPass1User(request.text),
        schema: PASS1_SCHEMA,
        temperature: 0.4,
      }),
    )
    const pass1 = normalizePass1(pass1Raw)
    if (pass1.candidates.length === 0) {
      throw new GeminiError('pass 1 returned no usable candidates', 200, false)
    }

    progress(`pass 1: ${pass1.candidates.length} candidates`)

    const maxFetch = this.opts.maxCandidatesToFetch ?? 3
    const pages: Array<{ url: string; title: string; text: string }> = []
    const fetchErrors: string[] = []
    for (const candidate of pass1.candidates.slice(0, maxFetch)) {
      try {
        const page = await fetchPageText(candidate.url)
        pages.push({ url: candidate.url, ...page })
        progress(`pass 2: fetched ${candidate.url}`)
      } catch (err) {
        fetchErrors.push(candidate.url)
        progress(`pass 2: fetch failed ${candidate.url}: ${(err as Error).message}`)
      }
    }

    progress('pass 2: verifying')
    const pass2Raw = await this.withRetry(() =>
      generateJson({
        apiKey: this.opts.apiKey,
        model: this.opts.model,
        systemInstruction: PASS2_SYSTEM,
        contents: buildPass2User({
          ideaText: request.text,
          summary: pass1.summary,
          criteria: pass1.criteria,
          candidates: pass1.candidates,
          pages,
          fetchErrors,
        }),
        schema: PASS2_SCHEMA,
        temperature: 0.3,
      }),
    )
    let picks = normalizePass2(pass2Raw, pass1.candidates)
    if (picks.length === 0) picks = this.fallbackFromPass1(pass1.candidates)

    progress('liveness: checking links')
    picks = await this.filterLive(picks)

    // Re-rank after any drops.
    return picks.map((p, i) => ({ ...p, rank: i + 1 }))
  }

  private fallbackFromPass1(candidates: ResearchCandidate[]): FinalPick[] {
    return candidates.slice(0, 5).map((c, i) => ({
      rank: i + 1,
      title: c.title,
      shop: c.shop,
      url: c.url,
      price: c.price ?? null,
      why: c.why ?? '',
    }))
  }

  private async filterLive(picks: FinalPick[]): Promise<FinalPick[]> {
    const checked = await Promise.all(
      picks.map(async (p) => {
        const status = await checkUrl(p.url)
        return { pick: p, status }
      }),
    )
    // Keep live + unknown (network hiccups shouldn't hide a real link).
    return checked
      .filter((c) => c.status !== 'dead')
      .map((c) => c.pick)
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let attempt = 0
    for (;;) {
      try {
        return await fn()
      } catch (err) {
        if (err instanceof GeminiError && err.retryable && attempt < MAX_429_RETRIES) {
          const delay = err.retryAfterMs ?? BACKOFF_BASE_MS * 2 ** attempt
          attempt += 1
          await sleep(delay)
          continue
        }
        throw err
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}