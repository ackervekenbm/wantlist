import { describe, expect, it } from 'vitest'
import { ResearchError, msUntilMidnight, type FailureKind } from '../src/server/research/errors'
import { ModelRouter, type GenerateArgs, type LlmProvider } from '../src/server/research/llm'

const ARGS: GenerateArgs = {
  systemInstruction: 'sys',
  contents: 'user',
  schema: { type: 'object' },
}

class FakeProvider implements LlmProvider {
  calls = 0
  constructor(
    readonly id: string,
    private readonly script: (call: number) => unknown,
  ) {}

  async generate(): Promise<unknown> {
    this.calls += 1
    const outcome = this.script(this.calls)
    if (outcome instanceof Error) throw outcome
    return outcome
  }
}

function fail(kind: FailureKind, retryAfterMs: number | null = null, message: string = kind): ResearchError {
  return new ResearchError(message, { kind, retryAfterMs })
}

function makeRouter(chain: LlmProvider[], clock?: { now: number }) {
  const sleeps: number[] = []
  const router = new ModelRouter({
    chain,
    now: clock ? () => clock.now : undefined,
    sleep: async (ms) => {
      sleeps.push(ms)
      if (clock) clock.now += ms
    },
    backoffBaseMs: 1,
  })
  return Object.assign(router, { sleeps })
}

describe('ModelRouter', () => {
  it('serves from the first healthy provider', async () => {
    const a = new FakeProvider('a', () => ({ ok: 1 }))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    await expect(makeRouter([a, b]).generate(ARGS)).resolves.toEqual({ ok: 1 })
    expect(b.calls).toBe(0)
  })

  it('benches a quota-limited model until its reset and advances at once', async () => {
    const clock = { now: 1_000_000 }
    const a = new FakeProvider('a', () => fail('quota', 5_000))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b], clock)

    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    await router.generate(ARGS)
    expect(a.calls).toBe(1)
    expect(router.health()).toEqual([
      { id: 'a', benchedUntil: new Date(1_005_000).toISOString(), reason: 'quota' },
      { id: 'b', benchedUntil: null, reason: null },
    ])

    clock.now += 6_000
    await router.generate(ARGS)
    expect(a.calls).toBe(2)
  })

  it('benches a quota error without a reset time for an hour', async () => {
    const clock = { now: 0 }
    const router = makeRouter([new FakeProvider('a', () => fail('quota')), new FakeProvider('b', () => 1)], clock)
    await router.generate(ARGS)
    expect(router.health()[0].benchedUntil).toBe(new Date(3_600_000).toISOString())
  })

  it('benches an unavailable model for a day and advances', async () => {
    const clock = { now: 0 }
    const a = new FakeProvider('a', () => fail('unavailable'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b], clock)
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(router.health()[0]).toMatchObject({
      reason: 'unavailable',
      benchedUntil: new Date(86_400_000).toISOString(),
    })
  })

  it('retries a transient error on the same entry, then advances', async () => {
    const flaky = new FakeProvider('a', (call) => (call < 3 ? fail('transient') : { ok: 'finally' }))
    await expect(makeRouter([flaky]).generate(ARGS)).resolves.toEqual({ ok: 'finally' })
    expect(flaky.calls).toBe(3)

    const dead = new FakeProvider('a', () => fail('transient'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    await expect(makeRouter([dead, b]).generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(dead.calls).toBe(4) // initial + 3 retries
  })

  it('treats unknown thrown values as transient', async () => {
    const a = new FakeProvider('a', () => new Error('boom'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    await expect(makeRouter([a, b]).generate(ARGS)).resolves.toEqual({ ok: 2 })
    expect(a.calls).toBe(4)
  })

  it('moves on from an unusable answer without benching the model', async () => {
    const a = new FakeProvider('a', () => fail('invalid'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    const router = makeRouter([a, b])
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 2 })
    await router.generate(ARGS)
    expect(a.calls).toBe(2)
    expect(router.health()[0].reason).toBeNull()
  })

  it('lets the caller reject an answer through parse, trying the next model', async () => {
    const a = new FakeProvider('a', () => ({ queries: [] }))
    const b = new FakeProvider('b', () => ({ queries: ['x'] }))
    const parse = (raw: unknown) => {
      const q = (raw as { queries: string[] }).queries
      if (q.length === 0) throw fail('invalid')
      return q
    }
    await expect(makeRouter([a, b]).generate(ARGS, parse)).resolves.toEqual(['x'])
  })

  it('fails the whole call on blocked content', async () => {
    const a = new FakeProvider('a', () => fail('blocked', null, 'SAFETY'))
    const b = new FakeProvider('b', () => ({ ok: 2 }))
    await expect(makeRouter([a, b]).generate(ARGS)).rejects.toThrow(/SAFETY/)
    expect(b.calls).toBe(0)
  })

  it('rethrows the last error when the chain ends on unusable answers', async () => {
    const a = new FakeProvider('a', () => fail('invalid', null, 'bad json from a'))
    const b = new FakeProvider('b', () => fail('invalid', null, 'bad json from b'))
    const err = (await makeRouter([a, b]).generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(err.kind).toBe('invalid')
    expect(err.message).toBe('bad json from b')
  })

  it('waits out a short rate limit when every model is benched', async () => {
    const clock = { now: 0 }
    const a = new FakeProvider('a', (call) => (call === 1 ? fail('quota', 30_000) : { ok: 1 }))
    const b = new FakeProvider('b', () => fail('quota', 45_000))
    const router = makeRouter([a, b], clock)
    await expect(router.generate(ARGS)).resolves.toEqual({ ok: 1 })
    expect(router.sleeps).toEqual([30_000])
  })

  it('reports every model out of quota with the earliest reset', async () => {
    const clock = { now: 0 }
    const a = new FakeProvider('a', () => fail('quota', 3_600_000))
    const b = new FakeProvider('b', () => fail('quota', 7_200_000))
    const router = makeRouter([a, b], clock)
    const err = (await router.generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(err).toBeInstanceOf(ResearchError)
    expect(err).toMatchObject({ kind: 'quota', allModelsOut: true, retryAfterMs: 3_600_000 })
    expect(err.message).toMatch(/Every model is out of free quota \(a, b\)/)
    expect(router.sleeps).toEqual([])

    clock.now += 600_000
    const again = (await router.generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(again.retryAfterMs).toBe(3_000_000)
    expect(a.calls).toBe(1)
  })

  it('reports a misconfigured chain when every model is unavailable', async () => {
    const a = new FakeProvider('a', () => fail('unavailable', null, 'a: not usable (HTTP 404)'))
    const err = (await makeRouter([a]).generate(ARGS).catch((e: unknown) => e)) as ResearchError
    expect(err.kind).toBe('unavailable')
    expect(err.retryable).toBe(false)
    expect(err.message).toMatch(/No model in the chain is usable.*HTTP 404/)
  })
})

describe('msUntilMidnight', () => {
  it('counts to midnight in the given zone', () => {
    // 2026-11-07 12:00 UTC is 04:00 in Los Angeles (PST, UTC-8): 20 h left there.
    expect(msUntilMidnight('America/Los_Angeles', Date.UTC(2026, 10, 7, 12))).toBe(20 * 3_600_000)
    expect(msUntilMidnight('UTC', Date.UTC(2026, 10, 7, 23, 30))).toBe(30 * 60_000)
  })
})
