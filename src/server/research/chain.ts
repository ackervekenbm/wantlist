import { GeminiProvider } from './gemini'
import { ModelRouter, type LlmProvider } from './llm'
import { OpenAiCompatProvider } from './openai'

export const DEFAULT_GEMINI_CHAIN = 'gemini-3.8-flash,gemini-3.5-flash,gemini-3.1-flash-lite'
export const DEFAULT_GROQ_MODEL = 'qwen/qwen3.8-27b'
export const DEFAULT_OPENROUTER_MODEL = 'google/gemma-4-31b-it:free'

/**
 * Builds the ordered provider chain from env:
 *   GEMINI_MODEL (primary override) -> MODEL_CHAIN (Gemini models) ->
 *   GROQ_API_KEY entry -> OPENROUTER_API_KEY entry.
 * Returns [] when no LLM provider is configured.
 */
export function buildProviderChain(env: NodeJS.ProcessEnv = process.env): LlmProvider[] {
  const chain: LlmProvider[] = []

  const geminiKey = env.GEMINI_API_KEY
  if (geminiKey) {
    const configured = (env.MODEL_CHAIN ?? DEFAULT_GEMINI_CHAIN)
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean)
    const primary = env.GEMINI_MODEL?.trim()
    const models = primary ? [primary, ...configured.filter((m) => m !== primary)] : configured
    for (const model of models) {
      chain.push(new GeminiProvider({ apiKey: geminiKey, model }))
    }
  }

  if (env.GROQ_API_KEY) {
    const model = env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL
    chain.push(
      new OpenAiCompatProvider({
        id: `groq:${model}`,
        baseUrl: 'https://api.groq.com/openai/v1',
        apiKey: env.GROQ_API_KEY,
        model,
      }),
    )
  }

  if (env.OPENROUTER_API_KEY) {
    const model = env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
    chain.push(
      new OpenAiCompatProvider({
        id: `openrouter:${model}`,
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: env.OPENROUTER_API_KEY,
        model,
      }),
    )
  }

  return chain
}

export function buildModelRouter(
  env: NodeJS.ProcessEnv = process.env,
  onEvent?: (message: string) => void,
): ModelRouter | null {
  const chain = buildProviderChain(env)
  return chain.length > 0 ? new ModelRouter({ chain, onEvent }) : null
}
