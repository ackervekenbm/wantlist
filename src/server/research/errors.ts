/**
 * What went wrong, which decides what happens next:
 *
 * | kind          | router (per model)                   | worker (per idea)  |
 * |---------------|--------------------------------------|--------------------|
 * | transient     | back off and retry, then next model  | retry later        |
 * | quota         | bench until the reset, next model    | retry after reset  |
 * | unavailable   | bench for a day, next model          | stop (config)      |
 * | invalid       | next model (answer was unusable)     | retry later        |
 * | blocked       | stop: content refused                | stop               |
 * | no-results    | -                                    | stop (reword idea) |
 */
export type FailureKind = 'transient' | 'quota' | 'unavailable' | 'invalid' | 'blocked' | 'no-results'

export interface ResearchErrorOptions {
  kind: FailureKind
  /** HTTP status when the failure came from an HTTP answer. */
  status?: number | null
  /** How long until trying again makes sense, when the source says so. */
  retryAfterMs?: number | null
  /** Set by the router when no model in the chain can answer right now. */
  allModelsOut?: boolean
}

export class ResearchError extends Error {
  readonly kind: FailureKind
  readonly status: number | null
  readonly retryAfterMs: number | null
  readonly allModelsOut: boolean

  constructor(message: string, opts: ResearchErrorOptions) {
    super(message)
    this.name = 'ResearchError'
    this.kind = opts.kind
    this.status = opts.status ?? null
    this.retryAfterMs = opts.retryAfterMs ?? null
    this.allModelsOut = opts.allModelsOut ?? false
  }

  /** Worth another automatic attempt at the idea later. */
  get retryable(): boolean {
    return this.kind === 'transient' || this.kind === 'quota' || this.kind === 'invalid'
  }
}

/** Anything thrown that is not a ResearchError is treated as a network-level flake. */
export function toResearchError(err: unknown): ResearchError {
  if (err instanceof ResearchError) return err
  return new ResearchError((err as Error)?.message ?? String(err), { kind: 'transient' })
}

/**
 * Milliseconds until the next local midnight in `timeZone`. Gemini's daily
 * free-tier quotas reset at midnight Pacific time. On a DST change day the
 * answer can be an hour off, which only shifts one retry.
 */
export function msUntilMidnight(timeZone: string, nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  }).formatToParts(new Date(nowMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  const elapsed = ((get('hour') * 60 + get('minute')) * 60 + get('second')) * 1000 + (nowMs % 1000)
  return 24 * 60 * 60 * 1000 - elapsed
}

/** Retry-After in seconds (the HTTP-date form is not used by these APIs). */
export function retryAfterHeaderMs(res: Response): number | null {
  const header = res.headers.get('Retry-After')
  if (!header) return null
  const seconds = Number.parseFloat(header)
  return Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds * 1000) : null
}
