import { describe, expect, it } from 'vitest'
import { apiKeys, buildProviderChain, DEFAULT_GEMINI_CHAIN } from './chain'

const defaults = DEFAULT_GEMINI_CHAIN.split(',').map((m) => `gemini:${m}`)
const ids = (env: NodeJS.ProcessEnv) => buildProviderChain(env).map((p) => p.id)

describe('buildProviderChain', () => {
  it('uses the default Gemini chain when MODEL_CHAIN is unset', () => {
    expect(ids({ GEMINI_API_KEY: 'k' })).toEqual(defaults)
  })

  it('treats an empty or blank MODEL_CHAIN as unset', () => {
    expect(ids({ GEMINI_API_KEY: 'k', MODEL_CHAIN: '' })).toEqual(defaults)
    expect(ids({ GEMINI_API_KEY: 'k', MODEL_CHAIN: ' , ' })).toEqual(defaults)
  })

  it('puts GEMINI_MODEL first and keeps a custom MODEL_CHAIN order', () => {
    expect(ids({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'b', MODEL_CHAIN: 'a, b' })).toEqual([
      'gemini:b',
      'gemini:a',
    ])
  })

  it('marks default and env-set models', () => {
    const src = (env: NodeJS.ProcessEnv) =>
      Object.fromEntries(buildProviderChain(env).map((p) => [p.id, p.modelSource]))
    const defaultsOnly = src({ GEMINI_API_KEY: 'k' })
    expect(Object.values(defaultsOnly)).toEqual(['default', 'default', 'default'])
    expect(src({ GEMINI_API_KEY: 'k', GEMINI_MODEL: 'x' })).toMatchObject({
      'gemini:x': 'env',
      [defaults[0]]: 'default',
    })
    expect(Object.values(src({ GEMINI_API_KEY: 'k', MODEL_CHAIN: 'a' }))).toEqual(['env'])
    expect(Object.values(src({ GROQ_API_KEY: 'k' }))).toEqual(['default'])
    expect(Object.values(src({ GROQ_API_KEY: 'k', GROQ_MODEL: 'm' }))).toEqual(['env'])
    expect(Object.values(src({ OPENROUTER_API_KEY: 'k' }))).toEqual(['default'])
    expect(Object.values(src({ OPENROUTER_API_KEY: 'k', OPENROUTER_MODEL: 'm' }))).toEqual(['env'])
  })
})

describe('apiKeys', () => {
  it('lists the four keys without values', () => {
    expect(apiKeys({ GROQ_API_KEY: 'g', SERPER_API_KEY: ' ' })).toEqual([
      { name: 'GEMINI_API_KEY', set: false },
      { name: 'GROQ_API_KEY', set: true },
      { name: 'OPENROUTER_API_KEY', set: false },
      { name: 'SERPER_API_KEY', set: false },
    ])
  })
})
