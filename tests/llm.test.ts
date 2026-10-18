import { describe, expect, it } from 'vitest'
import {
  ModelError,
  ModelRouter,
  type GenerateArgs,
  type LlmProvider,
} from '../src/server/research/llm'

const ARGS: GenerateArgs = {
  systemInstruction: 'sys',
  contents: 'user',
  schema: { type: 'object' },
}

type Outcome = unknown | Error

class FakeProvider implements LlmProvider {
  calls = 0
  constructor(
    readonly id: string,
    private readonly script: (call: number) => Outcome,
  ) {}

  async generate(): Promise<unknown> {
    this.calls += 1
    const outcome = this.script(this.calls)
    if (outcome instanceof Error) throw outcome
    return outcome
  }
}

function quotaError(retryAfterMs: number | null = null): ModelError {
  return new ModelError('quota', 429, true, retryAfterMs, true)
}

function transientError(): ModelError {
  return new ModelError('unavailable', 503, true)
}

function makeRouter(chain: LlmProvider[], now?: () => number): ModelRouter {
  return new ModelRouter({ chain, now, backoffBaseMs: 1 })
}

describe('ModelRouter', () => {
  it('serves from the first healthy provider', async () => {
    const a = new FakeProvider('a', () => ({ ok: 1 }))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 1 })
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(0)
  })

  it('advances immediately on a quota 429 without retrying the same entry', async () => {
    const a = new FakeProvider('a', () => quotaError())
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(a.calls).toBe(1)
  })

  it('memoizes quota exhaustion and skips the provider on later calls', async () => {
    const a = new FakeProvider('a', () => quotaError())
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await router.generate(ARGS)
    await router.generate(ARGS)
    expect(a.calls).toBe(1)
    expect(b.calls).toBe(2)
    expect(router.quotaBlocked()).toEqual(['a'])
  })

  it('expires the quota memo at the Retry-After deadline', async () => {
    let clock = 1_000_000
    const now = () => clock
    const a = new FakeProvider('a', () => quotaError(5_000))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b], now)

    await router.generate(ARGS) // a 429s, memoized until clock+5000
    await router.generate(ARGS) // a still blocked
    expect(a.calls).toBe(1)

    clock += 6_000
    await router.generate(ARGS) // memo expired, a tried again
    expect(a.calls).toBe(2)
  })

  it('expires a header-less quota memo at the next UTC midnight', async () => {
    // 2026-10-18 12:00:00 UTC
    let clock = Date.UTC(2026, 9, 18, 12)
    const a = new FakeProvider('a', () => quotaError(null))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b], () => clock)

    await router.generate(ARGS)
    await router.generate(ARGS)
    expect(a.calls).toBe(1)

    clock = Date.UTC(2026, 9, 19) // midnight UTC
    await router.generate(ARGS)
    expect(a.calls).toBe(2)
  })

  it('retries a transient error on the same entry before succeeding', async () => {
    const a = new FakeProvider('a', (call) =>
      call < 3 ? transientError() : { ok: 'finally' },
    )
    const router = makeRouter([a])
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 'finally' })
    expect(a.calls).toBe(3)
  })

  it('advances after transient retries are exhausted', async () => {
    const a = new FakeProvider('a', () => transientError())
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(a.calls).toBe(4) // initial + 3 retries
  })

  it('fails the call on a non-retryable error without advancing', async () => {
    const a = new FakeProvider('a', () => new ModelError('bad request', 400, false))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).rejects.toThrow(/bad request/)
    expect(b.calls).toBe(0)
  })

  it('throws a summary error when every provider is quota-blocked', async () => {
    const a = new FakeProvider('a', () => quotaError())
    const b = new FakeProvider('b', () => quotaError())
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).rejects.toThrow(/all 2 model\(s\) unavailable/)
  })

  it('wraps unknown thrown values as retryable ModelErrors', async () => {
    const a = new FakeProvider('a', () => new Error('boom'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    // unknown errors are retryable -> retried 4x on a, then advance
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(a.calls).toBe(4)
  })
})
