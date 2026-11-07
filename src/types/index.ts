/**
 * queued      - waiting for the worker (new, re-run, or a scheduled retry when
 *               `nextAttemptAt` is set)
 * researching - the worker is on it right now
 * done        - picks are in
 * error       - research gave up; only a manual re-run brings it back
 */
export type IdeaStatus = 'queued' | 'researching' | 'done' | 'error'

export type UrlStatus = 'live' | 'dead' | 'unknown'

export interface PickSupplier {
  shop: string
  url: string
  price: string | null
}

export interface Pick {
  id: number
  ideaId: number
  rank: number
  title: string
  shop: string | null
  url: string
  price: string | null
  why: string | null
  sourceUrls: string[]
  fetchedAt: string | null
  suppliers: PickSupplier[]
}

export interface Idea {
  id: number
  text: string
  status: IdeaStatus
  /** ISO-8601 (UTC). */
  createdAt: string
  /** When the current picks were researched (ISO-8601), null before the first success. */
  researchedAt: string | null
  /**
   * The last failure. Set on `error`, and on `queued` while a retry is
   * scheduled; cleared by a success or a manual re-run.
   */
  error: string | null
  /** Failed attempts since the last success or manual re-run. */
  attempts: number
  /** When a scheduled retry becomes due (ISO-8601), or null. */
  nextAttemptAt: string | null
  picks: Pick[]
}

export interface ServerStatus {
  /** False when no LLM key or no SERPER_API_KEY is configured. */
  researchEnabled: boolean
  /** Env vars that keep research disabled, for the UI to name. */
  missingKeys: string[]
  running: boolean
  lastRunAt: string | null
  lastRunResult: string | null
  /** Ideas waiting for the worker, including scheduled retries. */
  queuedCount: number
  /** The idea being researched right now and its latest step. */
  current: { ideaId: number; step: string } | null
}

export interface ResearchCandidate {
  title: string
  shop: string
  url: string
  price?: string | null
  why?: string | null
}

export interface Pass1Result {
  summary: string
  criteria: string[]
  candidates: ResearchCandidate[]
  followUpQueries: string[]
}

export interface FinalPick {
  rank: number
  title: string
  shop: string
  url: string
  price: string | null
  why: string
  /**
   * Every known shop offer for this product, best (lowest) price first. The
   * top-level shop/url/price mirror suppliers[0].
   */
  suppliers: PickSupplier[]
}

export interface ResearchRequest {
  ideaId: number
  text: string
  /** Called with a short human-readable step ("searching shops", ...). */
  onProgress?: (step: string) => void
}

export interface ResearchEngine {
  research(request: ResearchRequest): Promise<FinalPick[]>
}
