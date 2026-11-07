import type { ModelHealth } from '../../types'
import { ResearchError, toResearchError } from './errors'

export interface GenerateArgs {
  systemInstruction: string
  contents: string
  schema: object
  temperature?: number
}

export interface LlmProvider {
  /** Stable identifier, e.g. "gemini:gemini-3.8-flash" or "groq:qwen/qwen3.8-27b". */
  readonly id: string
  generate(args: GenerateArgs): Promise<unknown>
}

export interface ModelRouterOptions {
  chain: LlmProvider[]
  onEvent?: (message: string) => void
  /** Injectable clock for tests. */
  now?: () => number
  /** Injectable sleep for tests. */
  sleep?: (ms: number) => Promise<void>
  /** Base backoff for transient errors (default 3000 ms). */
  backoffBaseMs?: number
}


const MAX_ENTRY_RETRIES = 3
const BACKOFF_BASE_MS = 3000
/** A model that answered "not found" / "bad key" is skipped this long. */
const UNAVAILABLE_BENCH_MS = 24 * 60 * 60 * 1000
/** Used when a quota error carries no reset time. */
const DEFAULT_QUOTA_BENCH_MS = 60 * 60 * 1000
/**
 * When every entry is benched but one comes back within this window (a
 * per-minute rate limit), wait for it instead of failing the idea.
 */
const SHORT_WAIT_MS = 90_000

interface Bench {
  until: number
  reason: 'quota' | 'unavailable'
}

/**
 * Walks an ordered chain of LLM providers. Per entry, by failure kind:
 * - quota: bench until the reported reset (or an hour) and advance at once.
 * - unavailable (model gone, key refused): bench for a day and advance.
 * - transient (5xx, network): exponential backoff on the same entry, up to
 *   MAX_ENTRY_RETRIES, then advance.
 * - invalid (unparseable or unusable answer, including a `parse` rejection):
 *   advance; another model may answer properly.
 * - blocked (content refused): fail the call.
 * When every entry is benched, the call fails with `allModelsOut` and the
 * time until the earliest reset, unless that is within SHORT_WAIT_MS.
 */
export class ModelRouter {
  private readonly chain: LlmProvider[]
  private readonly onEvent: (message: string) => void
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly backoffBaseMs: number
  private readonly benches = new Map<string, Bench>()

  constructor(opts: ModelRouterOptions) {
    if (opts.chain.length === 0) throw new Error('ModelRouter requires at least one provider')
    this.chain = opts.chain
    this.onEvent = opts.onEvent ?? (() => {})
    this.now = opts.now ?? Date.now
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
    this.backoffBaseMs = opts.backoffBaseMs ?? BACKOFF_BASE_MS
  }

  get ids(): string[] {
    return this.chain.map((p) => p.id)
  }

  health(): ModelHealth[] {
    const now = this.now()
    return this.chain.map((p) => {
      const bench = this.activeBench(p.id, now)
      return {
        id: p.id,
        benchedUntil: bench ? new Date(bench.until).toISOString() : null,
        reason: bench?.reason ?? null,
      }
    })
  }

  /**
   * Generates with the first entry that answers. `parse` turns the raw JSON
   * into the caller's shape; when it throws an `invalid` ResearchError the
   * answer counts as unusable and the next entry is tried.
   */
  async generate<T = unknown>(args: GenerateArgs, parse?: (raw: unknown) => T): Promise<T> {
    for (let wait = 0; ; wait += 1) {
      const outcome = await this.walk(args, parse ?? ((raw) => raw as T))
      if (outcome.ok) return outcome.value

      const benched = this.chain.map((p) => this.activeBench(p.id, this.now()))
      if (benched.some((b) => b === null)) throw outcome.error

      const earliest = Math.min(...benched.map((b) => (b as Bench).until))
      const waitMs = Math.max(earliest - this.now(), 0)
      if (waitMs <= SHORT_WAIT_MS && wait === 0) {
        this.onEvent(`every model is rate limited; waiting ${Math.ceil(waitMs / 1000)} s`)
        await this.sleep(waitMs)
        continue
      }
      if (benched.every((b) => b?.reason === 'unavailable')) {
        throw new ResearchError(
          `No model in the chain is usable (${this.ids.join(', ')}): check the model names and API keys. Last error: ${outcome.error.message}`,
          { kind: 'unavailable' },
        )
      }
      throw new ResearchError(
        `Every model is out of free quota (${this.ids.join(', ')}); research resumes when the first one resets.`,
        { kind: 'quota', status: 429, retryAfterMs: waitMs, allModelsOut: true },
      )
    }
  }

  private async walk<T>(
    args: GenerateArgs,
    parse: (raw: unknown) => T,
  ): Promise<{ ok: true; value: T } | { ok: false; error: ResearchError }> {
    let lastError: ResearchError | null = null

    for (const entry of this.chain) {
      const bench = this.activeBench(entry.id, this.now())
      if (bench) continue

      for (let attempt = 0; ; attempt += 1) {
        try {
          const value = parse(await entry.generate(args))
          if (attempt > 0) this.onEvent(`${entry.id} served after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}`)
          return { ok: true, value }
        } catch (err) {
          const e = toResearchError(err)
          lastError = e

          if (e.kind === 'quota' || e.kind === 'unavailable') {
            const ms =
              e.retryAfterMs && e.retryAfterMs > 0
                ? e.retryAfterMs
                : e.kind === 'quota'
                  ? DEFAULT_QUOTA_BENCH_MS
                  : UNAVAILABLE_BENCH_MS
            const until = this.now() + ms
            this.benches.set(entry.id, { until, reason: e.kind })
            this.onEvent(`${entry.id} ${e.kind}, benched until ${new Date(until).toISOString()}: ${e.message.slice(0, 160)}`)
            break
          }

          if (e.kind === 'transient' && attempt < MAX_ENTRY_RETRIES) {
            const base = e.retryAfterMs ?? this.backoffBaseMs * 2 ** attempt
            const jitter = 0.8 + Math.random() * 0.4
            this.onEvent(
              `${entry.id} transient error (attempt ${attempt + 1}/${MAX_ENTRY_RETRIES}): ${e.message.slice(0, 120)}`,
            )
            await this.sleep(Math.round(base * jitter))
            continue
          }

          if (e.kind === 'transient' || e.kind === 'invalid') {
            this.onEvent(`${entry.id} ${e.kind === 'invalid' ? 'gave an unusable answer' : 'still failing'}, advancing: ${e.message.slice(0, 120)}`)
            break
          }

          throw e
        }
      }
    }

    return { ok: false, error: lastError ?? new ResearchError('model chain failed', { kind: 'transient' }) }
  }

  private activeBench(id: string, now: number): Bench | null {
    const bench = this.benches.get(id)
    return bench && bench.until > now ? bench : null
  }
}
