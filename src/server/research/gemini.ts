import { ResearchError, msUntilMidnight, retryAfterHeaderMs } from './errors'
import { parseJsonLoose } from './json'
import type { GenerateArgs, LlmProvider } from './llm'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'
const TIMEOUT_MS = 90_000
/** Gemini's daily free-tier quotas reset at midnight Pacific time. */
const QUOTA_TIME_ZONE = 'America/Los_Angeles'
const DEFAULT_RATE_LIMIT_MS = 60_000

const BLOCKED_FINISH = new Set(['SAFETY', 'RECITATION', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII'])

export interface GeminiOptions {
  apiKey: string
  model: string
  /** Injectable clock for tests (quota reset times). */
  now?: () => number
}

export class GeminiProvider implements LlmProvider {
  readonly id: string

  constructor(private readonly opts: GeminiOptions) {
    this.id = `gemini:${opts.model}`
  }

  async generate(args: GenerateArgs): Promise<unknown> {
    const url = `${BASE}/models/${encodeURIComponent(this.opts.model)}:generateContent`
    const body = {
      systemInstruction: { parts: [{ text: args.systemInstruction }] },
      contents: [{ role: 'user', parts: [{ text: args.contents }] }],
      generationConfig: {
        temperature: args.temperature ?? 0.3,
        responseMimeType: 'application/json',
        responseSchema: args.schema,
      },
    }

    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        // Header, not ?key=: URLs end up in logs and error messages.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.opts.apiKey },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new ResearchError(`${this.id}: request failed (${(err as Error).message})`, { kind: 'transient' })
    }

    if (!res.ok) throw await this.httpError(res)

    const json = (await res.json()) as GeminiResponse
    const blockReason = json.promptFeedback?.blockReason
    if (blockReason) {
      throw new ResearchError(`${this.id}: request blocked (${blockReason})`, { kind: 'blocked' })
    }
    const candidate = json.candidates?.[0]
    if (candidate?.finishReason && BLOCKED_FINISH.has(candidate.finishReason)) {
      throw new ResearchError(`${this.id}: answer blocked (${candidate.finishReason})`, { kind: 'blocked' })
    }
    const text = candidate?.content?.parts?.map((p) => p.text ?? '').join('')
    if (!text) {
      throw new ResearchError(`${this.id}: empty answer (${candidate?.finishReason ?? 'no candidate'})`, {
        kind: 'invalid',
      })
    }
    try {
      return parseJsonLoose(text)
    } catch {
      throw new ResearchError(`${this.id}: answer is not valid JSON (${candidate?.finishReason ?? '?'})`, {
        kind: 'invalid',
      })
    }
  }

  private async httpError(res: Response): Promise<ResearchError> {
    const raw = await res.text().catch(() => '')
    const info = parseGoogleError(raw)
    const detail = info.message ? `: ${info.message.slice(0, 200)}` : ''
    const status = res.status

    if (status === 429) {
      const now = this.opts.now?.() ?? Date.now()
      const daily = info.quotaIds.some((q) => /per\s*day/i.test(q))
      if (daily) {
        return new ResearchError(`${this.id}: daily free quota used up (resets at midnight Pacific)`, {
          kind: 'quota',
          status,
          retryAfterMs: msUntilMidnight(QUOTA_TIME_ZONE, now),
        })
      }
      const retryAfterMs = info.retryDelayMs ?? retryAfterHeaderMs(res) ?? DEFAULT_RATE_LIMIT_MS
      return new ResearchError(`${this.id}: rate limited${detail}`, { kind: 'quota', status, retryAfterMs })
    }
    if (status >= 500) {
      return new ResearchError(`${this.id}: unavailable (HTTP ${status})${detail}`, {
        kind: 'transient',
        status,
        retryAfterMs: retryAfterHeaderMs(res),
      })
    }
    // A retired or misspelled model 404s; a bad key is a 400 API_KEY_INVALID or a 401/403.
    if (status === 404 || status === 401 || status === 403 || info.reasons.includes('API_KEY_INVALID')) {
      return new ResearchError(`${this.id}: not usable (HTTP ${status})${detail}`, { kind: 'unavailable', status })
    }
    return new ResearchError(`${this.id}: request rejected (HTTP ${status})${detail}`, { kind: 'invalid', status })
  }
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> }
    finishReason?: string
  }>
  promptFeedback?: { blockReason?: string }
}

interface GoogleErrorInfo {
  message: string
  quotaIds: string[]
  reasons: string[]
  retryDelayMs: number | null
}

/**
 * Google APIs put the useful parts of an error in `error.details`:
 * QuotaFailure (which quota: per minute or per day), RetryInfo (how long to
 * wait, e.g. "37s") and ErrorInfo (a reason such as API_KEY_INVALID).
 */
export function parseGoogleError(raw: string): GoogleErrorInfo {
  const info: GoogleErrorInfo = { message: '', quotaIds: [], reasons: [], retryDelayMs: null }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    info.message = raw.trim()
    return info
  }
  const error = (parsed as { error?: { message?: unknown; details?: unknown } })?.error
  if (typeof error?.message === 'string') info.message = error.message.split('\n')[0]
  for (const d of Array.isArray(error?.details) ? error.details : []) {
    const type = String((d as { '@type'?: unknown })?.['@type'] ?? '')
    if (type.endsWith('QuotaFailure')) {
      for (const v of (d as { violations?: Array<{ quotaId?: unknown }> }).violations ?? []) {
        if (typeof v?.quotaId === 'string') info.quotaIds.push(v.quotaId)
      }
    } else if (type.endsWith('RetryInfo')) {
      const m = /^(\d+(?:\.\d+)?)s$/.exec(String((d as { retryDelay?: unknown }).retryDelay ?? ''))
      if (m) info.retryDelayMs = Math.ceil(Number(m[1]) * 1000)
    } else if (type.endsWith('ErrorInfo')) {
      const reason = (d as { reason?: unknown }).reason
      if (typeof reason === 'string') info.reasons.push(reason)
    }
  }
  return info
}

