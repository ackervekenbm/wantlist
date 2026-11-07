import { ResearchError, retryAfterHeaderMs } from './errors'
import { parseJsonLoose } from './json'
import type { GenerateArgs, LlmProvider } from './llm'

export interface OpenAiCompatOptions {
  /** Stable identifier shown in logs, e.g. "groq:qwen/qwen3.8-27b". */
  id: string
  /** Base URL including /v1, e.g. "https://api.groq.com/openai/v1". */
  baseUrl: string
  apiKey: string
  model: string
}

const TIMEOUT_MS = 90_000
const DEFAULT_429_BENCH_MS = 15 * 60 * 1000

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
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new ResearchError(`${this.id}: request failed (${(err as Error).message})`, { kind: 'transient' })
    }

    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      const suffix = detail ? `: ${detail}` : ''
      if (res.status === 429) {
        throw new ResearchError(`${this.id}: rate limited${suffix}`, {
          kind: 'quota',
          status: 429,
          retryAfterMs: retryAfterHeaderMs(res) ?? DEFAULT_429_BENCH_MS,
        })
      }
      if (res.status >= 500) {
        throw new ResearchError(`${this.id}: unavailable (HTTP ${res.status})${suffix}`, {
          kind: 'transient',
          status: res.status,
        })
      }
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        throw new ResearchError(`${this.id}: not usable (HTTP ${res.status})${suffix}`, {
          kind: 'unavailable',
          status: res.status,
        })
      }
      throw new ResearchError(`${this.id}: request rejected (HTTP ${res.status})${suffix}`, {
        kind: 'invalid',
        status: res.status,
      })
    }

    const json = (await res.json()) as OpenAiCompatResponse
    const text = json.choices?.[0]?.message?.content
    if (!text || !text.trim()) {
      throw new ResearchError(`${this.id}: empty answer`, { kind: 'invalid' })
    }
    try {
      return parseJsonLoose(text)
    } catch {
      throw new ResearchError(`${this.id}: answer is not valid JSON: ${text.slice(0, 120)}`, { kind: 'invalid' })
    }
  }
}

interface OpenAiCompatResponse {
  choices?: Array<{ message?: { content?: string } }>
}
