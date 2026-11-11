import { describe, expect, it } from 'vitest'
import { buildProviderChain, DEFAULT_GEMINI_CHAIN } from '../src/server/research/chain'

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
})
