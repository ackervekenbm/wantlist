import { afterEach, describe, expect, it, vi } from 'vitest'
import { ResearchError } from '../src/server/research/errors'
import { GeminiProvider, parseGoogleError } from '../src/server/research/gemini'

const ARGS = { systemInstruction: 'sys', contents: 'user', schema: { type: 'object' } }
// 2026-11-07 12:00 UTC = 04:00 in Los Angeles: 20 h until the daily reset.
const NOW = Date.UTC(2026, 10, 7, 12)

function provider(): GeminiProvider {
  return new GeminiProvider({ apiKey: 'secret-key', model: 'gemini-3.8-flash', now: () => NOW })
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Error) {
  const fn = vi.fn(async (url: string, init: RequestInit) => {
    const result = handler(url, init)
    if (result instanceof Error) throw result
    return result
  })
  vi.stubGlobal('fetch', fn)
  return fn
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function answer(text: string, finishReason = 'STOP'): Response {
  return json({ candidates: [{ content: { parts: [{ text }] }, finishReason }] })
}

function googleError(code: number, message: string, details: unknown[] = []): Response {
  return json({ error: { code, message, status: 'X', details } }, code)
}

async function failure(): Promise<ResearchError> {
  const err = await provider().generate(ARGS).catch((e: unknown) => e)
  expect(err).toBeInstanceOf(ResearchError)
  return err as ResearchError
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GeminiProvider', () => {
  it('sends the key in a header, never in the URL, and parses the JSON answer', async () => {
    const fetch = stubFetch(() => answer('{"ok":true}'))
    await expect(provider().generate(ARGS)).resolves.toEqual({ ok: true })
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(url).not.toContain('secret-key')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key')
    const body = JSON.parse(String(init.body))
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: ARGS.schema })
  })

  it('benches a per-minute 429 for the RetryInfo delay, not until midnight', async () => {
    stubFetch(() =>
      googleError(429, 'Resource has been exhausted', [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '37s' },
      ]),
    )
    const err = await failure()
    expect(err).toMatchObject({ kind: 'quota', status: 429, retryAfterMs: 37_000 })
  })

  it('benches a daily 429 until midnight Pacific', async () => {
    stubFetch(() =>
      googleError(429, 'Quota exceeded', [
        {
          '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
          violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }],
        },
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '12s' },
      ]),
    )
    const err = await failure()
    expect(err).toMatchObject({ kind: 'quota', retryAfterMs: 20 * 3_600_000 })
    expect(err.message).toMatch(/daily free quota/)
  })

  it('falls back to a minute for a bare 429', async () => {
    stubFetch(() => new Response('slow down', { status: 429 }))
    expect(await failure()).toMatchObject({ kind: 'quota', retryAfterMs: 60_000 })
  })

  it('treats 5xx and network failures as transient', async () => {
    stubFetch(() => googleError(503, 'The model is overloaded. Please try again later.'))
    const overloaded = await failure()
    expect(overloaded).toMatchObject({ kind: 'transient', status: 503 })
    expect(overloaded.message).toContain('overloaded')

    stubFetch(() => new Error('ECONNRESET'))
    expect(await failure()).toMatchObject({ kind: 'transient' })
  })

  it('marks a retired model or refused key unavailable', async () => {
    stubFetch(() => googleError(404, 'models/gemini-2.5-flash is not found'))
    expect(await failure()).toMatchObject({ kind: 'unavailable', status: 404 })

    stubFetch(() =>
      googleError(400, 'API key not valid. Please pass a valid API key.', [
        { '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' },
      ]),
    )
    expect(await failure()).toMatchObject({ kind: 'unavailable', status: 400 })
  })

  it('marks other 400s invalid so another model can try', async () => {
    stubFetch(() => googleError(400, 'Invalid JSON schema'))
    expect(await failure()).toMatchObject({ kind: 'invalid', status: 400 })
  })

  it('fails blocked content as blocked', async () => {
    stubFetch(() => answer('', 'SAFETY'))
    expect(await failure()).toMatchObject({ kind: 'blocked' })

    stubFetch(() => json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }))
    expect(await failure()).toMatchObject({ kind: 'blocked' })
  })

  it('marks empty, truncated or non-JSON answers invalid', async () => {
    stubFetch(() => json({ candidates: [] }))
    expect(await failure()).toMatchObject({ kind: 'invalid' })

    stubFetch(() => answer('{"picks": [{"title": "half', 'MAX_TOKENS'))
    const truncated = await failure()
    expect(truncated.kind).toBe('invalid')
    expect(truncated.message).toContain('MAX_TOKENS')
  })
})

describe('parseGoogleError', () => {
  it('tolerates non-JSON bodies', () => {
    expect(parseGoogleError('<html>Bad Gateway</html>')).toEqual({
      message: '<html>Bad Gateway</html>',
      quotaIds: [],
      reasons: [],
      retryDelayMs: null,
    })
  })

  it('reads fractional retry delays', () => {
    const info = parseGoogleError(
      JSON.stringify({ error: { details: [{ '@type': 'x/google.rpc.RetryInfo', retryDelay: '1.5s' }] } }),
    )
    expect(info.retryDelayMs).toBe(1500)
  })
})
