export class ModelError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly retryAfterMs: number | null = null,
    readonly quotaExhausted = false,
  ) {
    super(message)
    this.name = 'ModelError'
  }
}

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
  /** Base backoff for transient errors (default 3000 ms). */
  backoffBaseMs?: number
}

const MAX_ENTRY_RETRIES = 3
const BACKOFF_BASE_MS = 3000

/**
 * Walks an ordered chain of LLM providers. Failover rules:
 * - quota-exhausted (daily/rate-limit 429): memoize the provider as unavailable
 *   until its Retry-After (or next 00:00 UTC) and advance immediately - a daily
 *   quota will not heal within one idea's backoff window.
 * - transient (5xx, network, short Retry-After 429): retry the same entry with
 *   exponential backoff up to MAX_ENTRY_RETRIES, then advance.
 * - non-retryable (safety, bad request, unparseable): fail the whole call.
 */
export class ModelRouter {
  private readonly chain: LlmProvider[]
  private readonly onEvent: (message: string) => void
  private readonly now: () => number
  private readonly backoffBaseMs: number
  private readonly quotaUntil = new Map<string, number>()

  constructor(opts: ModelRouterOptions) {
    if (opts.chain.length === 0) throw new Error('ModelRouter requires at least one provider')
    this.chain = opts.chain
    this.onEvent = opts.onEvent ?? (() => {})
    this.now = opts.now ?? Date.now
    this.backoffBaseMs = opts.backoffBaseMs ?? BACKOFF_BASE_MS
  }

  get ids(): string[] {
    return this.chain.map((p) => p.id)
  }

  /** Providers currently skipped due to memoized quota exhaustion. */
  quotaBlocked(nowMs = this.now()): string[] {
    return this.chain
      .filter((p) => (this.quotaUntil.get(p.id) ?? 0) > nowMs)
      .map((p) => p.id)
  }

  async generate(args: GenerateArgs): Promise<unknown> {
    let lastError: ModelError | null = null

    for (const entry of this.chain) {
      const blockedUntil = this.quotaUntil.get(entry.id) ?? 0
      if (blockedUntil > this.now()) {
        this.onEvent(`${entry.id} skipped (quota until ${new Date(blockedUntil).toISOString()})`)
        continue
      }

      for (let attempt = 0; ; attempt += 1) {
        try {
          const result = await entry.generate(args)
          if (attempt > 0) this.onEvent(`${entry.id} served after ${attempt} retr${attempt === 1 ? 'y' : 'ies'}`)
          return result
        } catch (err) {
          const e = toModelError(err)
          lastError = e

          if (e.quotaExhausted) {
            const until =
              e.retryAfterMs && e.retryAfterMs > 0
                ? this.now() + e.retryAfterMs
                : nextUtcMidnight(this.now())
            this.quotaUntil.set(entry.id, until)
            this.onEvent(
              `${entry.id} quota exhausted, skipping until ${new Date(until).toISOString()}`,
            )
            break
          }

          if (e.retryable && attempt < MAX_ENTRY_RETRIES) {
            const base = e.retryAfterMs ?? this.backoffBaseMs * 2 ** attempt
            const jitter = 0.8 + Math.random() * 0.4
            this.onEvent(
              `${entry.id} transient error (attempt ${attempt + 1}/${MAX_ENTRY_RETRIES}): ${e.message.slice(0, 120)}`,
            )
            await sleep(Math.round(base * jitter))
            continue
          }

          if (e.retryable) {
            this.onEvent(`${entry.id} still failing after ${MAX_ENTRY_RETRIES} retries, advancing`)
            break
          }

          throw e
        }
      }
    }

    if (this.quotaBlocked().length === this.chain.length) {
      throw new ModelError(
        `all ${this.chain.length} model(s) unavailable (quota exhausted): ${this.ids.join(', ')}`,
        429,
        true,
      )
    }
    throw lastError ?? new ModelError('model chain failed', 500, false)
  }
}

function toModelError(err: unknown): ModelError {
  if (err instanceof ModelError) return err
  return new ModelError((err as Error)?.message ?? String(err), 0, true)
}

function nextUtcMidnight(nowMs: number): number {
  const d = new Date(nowMs)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
