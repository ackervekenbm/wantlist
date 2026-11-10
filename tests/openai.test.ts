import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenAiCompatProvider } from '../src/server/research/openai'
import { ResearchError } from '../src/server/research/errors'

const ARGS = {
  systemInstruction: 'Pick candidates.',
  contents: 'idea text',
  schema: { type: 'object', properties: { a: { type: 'string' } } },
}

function provider(): OpenAiCompatProvider {
  return new OpenAiCompatProvider({
    id: 'groq:test-model',
    baseUrl: 'https://api.example.com/openai/v1/',
    apiKey: 'key-123',
    model: 'test-model',
  })
}

function stubFetch(handler: (url: string, init: RequestInit) => Response | Error): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const result = handler(url, init)
      if (result instanceof Error) throw result
      return result
    }),
  )
}

function chatResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAiCompatProvider', () => {
  it('posts an OpenAI-style chat completion and parses the JSON content', async () => {
    const captured: { url?: string; init?: RequestInit } = {}
    stubFetch((url, init) => {
      captured.url = url
      captured.init = init
      return chatResponse('{"a":"b"}')
    })

    const result = await provider().generate(ARGS)
    expect(result).toEqual({ a: 'b' })
    expect(captured.url).toBe('https://api.example.com/openai/v1/chat/completions')

    const body = JSON.parse(String(captured.init?.body))
    expect(body.model).toBe('test-model')
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.messages[0].role).toBe('system')
    expect(body.messages[0].content).toContain('Pick candidates.')
    expect(body.messages[0].content).toContain('properties')
    expect(body.messages[1]).toEqual({ role: 'user', content: 'idea text' })
    const headers = captured.init?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer key-123')
  })

  it('parses JSON wrapped in code fences or prose (weaker models)', async () => {
    stubFetch(() => chatResponse('Sure!\n```json\n{"a":"fenced"}\n```'))
    await expect(provider().generate(ARGS)).resolves.toEqual({ a: 'fenced' })
  })

  it('maps 429 with Retry-After to a quota error with that deadline', async () => {
    stubFetch(
      () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'Retry-After': '7' },
        }),
    )
    const err = await provider().generate(ARGS).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ResearchError)
    const me = err as ResearchError
    expect(me.status).toBe(429)
    expect(me.kind).toBe('quota')
    expect(me.retryAfterMs).toBe(7000)
  })

  it('memoizes a header-less 429 for 15 minutes by default', async () => {
    stubFetch(() => new Response('rate limited', { status: 429 }))
    const me = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(me.kind).toBe('quota')
    expect(me.retryAfterMs).toBe(15 * 60 * 1000)
  })

  it('maps 5xx to retryable errors', async () => {
    stubFetch(() => new Response('oops', { status: 503 }))
    const me = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(me.retryable).toBe(true)
    expect(me.status).toBe(503)
  })

  it('maps a refused key or unknown model to unavailable', async () => {
    for (const status of [401, 403, 404]) {
      stubFetch(() => new Response('bad key', { status }))
      const me = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
      expect(me.kind).toBe('unavailable')
      expect(me.retryable).toBe(false)
      expect(me.status).toBe(status)
      expect(me.message).toContain('bad key')
    }
  })

  it('maps other 4xx to invalid, so the router tries the next model', async () => {
    stubFetch(() => new Response('schema not supported', { status: 400 }))
    const me = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(me.kind).toBe('invalid')
  })

  it('maps network failures to retryable errors', async () => {
    stubFetch(() => new Error('ECONNRESET'))
    const me = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(me.retryable).toBe(true)
    expect(me.message).toContain('ECONNRESET')
  })

  it('marks empty or unparseable content invalid', async () => {
    stubFetch(() => chatResponse(''))
    const empty = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(empty.kind).toBe('invalid')
    expect(empty.message).toContain('empty answer')

    stubFetch(() => chatResponse('not json at all'))
    const junk = (await provider().generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(junk.kind).toBe('invalid')
    expect(junk.message).toContain('not valid JSON')
  })
})
