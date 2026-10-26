import { parseJsonLoose } from './gemini'
import { ModelError, type GenerateArgs, type LlmProvider } from './llm'

export interface OpenAiCompatOptions {
  /** Stable identifier shown in logs, e.g. "groq:qwen/qwen3.8-27b". */
  id: string
  /** Base URL including /v1, e.g. "https://api.groq.com/openai/v1". */
  baseUrl: string
  apiKey: string
  model: string
}

const TIMEOUT_MS = 90_000
const DEFAULT_429_MEMO_MS = 15 * 60 * 1000

/**
 * Generic OpenAI-compatible chat-completions provider. Works for Groq,
 * OpenRouter, and anything else speaking the same API; JSON mode is requested
 * via response_format plus the schema embedded in the prompt (schemas are not
 * portable across providers the way Gemini's responseSchema is).
 */
export class OpenAiCompatProvider implements LlmProvider {
  readonly id: string

  constructor(private readonly opts: OpenAiCompatOptions) {
    this.id = opts.id
  }

  async generate(args: GenerateArgs): Promise<unknown> {
    const url = `${this.opts.baseUrl.replace(/\/+$/, '')}/chat/completions`
    const body = {
      model: this.opts.model,
      temperature: args.temperature ?? 0.3,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `${args.systemInstruction}\n\nReturn ONLY valid JSON matching this JSON Schema (no prose, no code fences):\n${JSON.stringify(args.schema)}`,
        },
        { role: 'user', content: args.contents },
      ],
    }

    let res: Response
    try {
      const controller = new AbortController()
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.opts.apiKey}`,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timer)
      }
    } catch (err) {
      throw new ModelError(`${this.id} fetch failed: ${(err as Error).message}`, 0, true)
    }

    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('Retry-After')
      const retryAfterSec = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : NaN
      const retryAfterMs = Number.isFinite(retryAfterSec) && retryAfterSec > 0
        ? retryAfterSec * 1000
        : DEFAULT_429_MEMO_MS
      const detail = (await res.text()).slice(0, 300)
      throw new ModelError(
        `${this.id} rate limited (HTTP 429)${detail ? `: ${detail}` : ''}`,
        429,
        true,
        retryAfterMs,
        true,
      )
    }
    if (res.status >= 500) {
      const detail = (await res.text()).slice(0, 300)
      throw new ModelError(`${this.id} HTTP ${res.status}: ${detail}`, res.status, true)
    }
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300)
      throw new ModelError(`${this.id} HTTP ${res.status}: ${detail}`, res.status, false)
    }

    const json = (await res.json()) as OpenAiCompatResponse
    const text = json.choices?.[0]?.message?.content
    if (!text || !text.trim()) {
      throw new ModelError(`${this.id} returned no message content`, 400, false)
    }
    try {
      return parseJsonLoose(text)
    } catch {
      throw new ModelError(
        `${this.id} returned unparseable JSON: ${text.slice(0, 200)}`,
        400,
        false,
      )
    }
  }
}

interface OpenAiCompatResponse {
  choices?: Array<{ message?: { content?: string } }>
}
