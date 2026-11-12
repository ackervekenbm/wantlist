import { describe, expect, it, vi } from 'vitest'
import { createIdea, getIdea, reactToPick, requeueIdea } from '../src/server/db'
import { ResearchError, type FailureKind } from '../src/server/research/errors'
import { DEFAULT_RETRY, createWorker, retryAt, type WorkerOptions } from '../src/server/worker'
import type { ResearchEngine, ResearchRequest, ResearchResult } from '../src/types'
import { researchResult, tempDb } from './helpers'

function fail(
  message: string,
  kind: FailureKind,
  extra: { status?: number; retryAfterMs?: number; allModelsOut?: boolean } = {},
) {
  return new ResearchError(message, { kind, ...extra })
}

const NOW = new Date('2026-11-07T12:00:00Z')

function engineOf(fn: (req: ResearchRequest) => Promise<ResearchResult>): ResearchEngine & {
  calls: ResearchRequest[]
} {
  const calls: ResearchRequest[] = []
  return {
    calls,
    research: (req) => {
      calls.push(req)
      return fn(req)
    },
  }
}

function makeWorker(opts: Partial<WorkerOptions> & Pick<WorkerOptions, 'db' | 'engine'>) {
  return createWorker({ intervalMs: 0, queueCap: 10, log: () => {}, now: () => NOW, ...opts })
}

describe('retryAt', () => {
  const policy = { baseMs: 1000, maxMs: 5000, maxAttempts: 4 }

  it('backs off exponentially up to the ceiling', () => {
    const err = fail('503', 'transient')
    expect(retryAt(err, 1, NOW, policy)?.getTime()).toBe(NOW.getTime() + 1000)
    expect(retryAt(err, 2, NOW, policy)?.getTime()).toBe(NOW.getTime() + 2000)
    expect(retryAt(err, 3, NOW, policy)?.getTime()).toBe(NOW.getTime() + 4000)
  })

  it('retries an unusable model answer', () => {
    expect(retryAt(fail('bad json', 'invalid'), 1, NOW, policy)).not.toBeNull()
  })

  it('waits for a quota reset rather than the shorter backoff', () => {
    const err = fail('quota', 'quota', { status: 429, retryAfterMs: 60_000, allModelsOut: true })
    expect(retryAt(err, 1, NOW, policy)?.getTime()).toBe(NOW.getTime() + 60_000)
  })

  it('gives up on permanent errors and when the budget is spent', () => {
    expect(retryAt(fail('bad', 'blocked'), 1, NOW, policy)).toBeNull()
    expect(retryAt(fail('no key', 'unavailable'), 1, NOW, policy)).toBeNull()
    expect(retryAt(fail('reword', 'no-results'), 1, NOW, policy)).toBeNull()
    expect(retryAt(new Error('bug'), 1, NOW, policy)).toBeNull()
    expect(retryAt(fail('503', 'transient'), 4, NOW, policy)).toBeNull()
  })

  it('defaults to a 15-minute first retry', () => {
    const err = fail('503', 'transient')
    expect(retryAt(err, 1, NOW, DEFAULT_RETRY)?.getTime()).toBe(NOW.getTime() + 15 * 60 * 1000)
  })
})

describe('worker', () => {
  it('researches due ideas oldest first and stores the picks', async () => {
    const { db } = tempDb()
    const a = createIdea(db, 'fan')
    const b = createIdea(db, 'lamp')
    const engine = engineOf(async () => researchResult())
    const summary = await makeWorker({ db, engine }).runOnce()

    expect(engine.calls.map((c) => c.ideaId)).toEqual([a, b])
    expect(summary).toMatchObject({ attempted: 2, succeeded: 2, failed: 0, retrying: 0 })
    expect(getIdea(db, a)).toMatchObject({ status: 'done' })
    expect(getIdea(db, a)?.picks).toHaveLength(2)
  })

  it('passes budget and notes to the engine', async () => {
    const { db } = tempDb()
    createIdea(db, { text: 'shoes', budget: 99, notes: 'wide' })
    const engine = engineOf(async () => researchResult())
    await makeWorker({ db, engine }).runOnce()
    expect(engine.calls[0]).toMatchObject({ text: 'shoes', budget: 99, notes: 'wide' })
  })

  it('respects the per-pass cap', async () => {
    const { db } = tempDb()
    createIdea(db, 'a')
    createIdea(db, 'b')
    createIdea(db, 'c')
    const engine = engineOf(async () => researchResult())
    await makeWorker({ db, engine, queueCap: 2 }).runOnce()
    expect(engine.calls).toHaveLength(2)
  })

  it('schedules a retry for transient errors and keeps the idea queued', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    const engine = engineOf(async () => {
      throw fail('Gemini unavailable (HTTP 503)', 'transient')
    })
    const summary = await makeWorker({ db, engine }).runOnce()

    expect(summary).toMatchObject({ retrying: 1, failed: 0 })
    const idea = getIdea(db, id)!
    expect(idea).toMatchObject({ status: 'queued', attempts: 1, error: 'Gemini unavailable (HTTP 503)' })
    expect(idea.nextAttemptAt).toBe(new Date(NOW.getTime() + DEFAULT_RETRY.baseMs).toISOString())

    // Not due yet: a second pass leaves it alone.
    await makeWorker({ db, engine }).runOnce()
    expect(engine.calls).toHaveLength(1)
  })

  it('stops at error for permanent failures', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    const engine = engineOf(async () => {
      throw fail('Gemini blocked (SAFETY)', 'blocked')
    })
    await makeWorker({ db, engine }).runOnce()
    expect(getIdea(db, id)).toMatchObject({ status: 'error', error: 'Gemini blocked (SAFETY)' })
  })

  it('treats an empty result as a failure that needs rewording', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    await makeWorker({ db, engine: engineOf(async () => researchResult([])) }).runOnce()
    expect(getIdea(db, id)?.status).toBe('error')
    expect(getIdea(db, id)?.error).toMatch(/rewording/)
  })

  it('stops the pass when every model is out of quota', async () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    const engine = engineOf(async () => {
      throw fail('all out', 'quota', { status: 429, retryAfterMs: 3_600_000, allModelsOut: true })
    })
    await makeWorker({ db, engine }).runOnce()
    expect(engine.calls).toHaveLength(1)
    expect(getIdea(db, a)?.nextAttemptAt).toBe(new Date(NOW.getTime() + 3_600_000).toISOString())
    expect(getIdea(db, b)).toMatchObject({ status: 'queued', attempts: 0 })
  })

  it('reports the current step while researching', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const engine = engineOf(async (req) => {
      req.onProgress?.('searching shops')
      await gate
      return researchResult()
    })
    const worker = makeWorker({ db, engine })
    const run = worker.runOnce()
    await vi.waitFor(() => expect(worker.state().current).toEqual({ ideaId: id, step: 'searching shops' }))
    expect(worker.state().running).toBe(true)
    release()
    await run
    expect(worker.state()).toMatchObject({ running: false, current: null })
  })

  it('runs a follow-up pass for work that arrived mid-pass', async () => {
    const { db } = tempDb()
    createIdea(db, 'first')
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const engine = engineOf(async (req) => {
      if (req.text === 'first') await gate
      return researchResult()
    })
    const worker = makeWorker({ db, engine })
    const first = worker.runOnce()
    await vi.waitFor(() => expect(engine.calls).toHaveLength(1))

    const late = createIdea(db, 'late')
    expect((await worker.runOnce()).message).toMatch(/already running/)
    release()
    await first
    await vi.waitFor(() => expect(getIdea(db, late)?.status).toBe('done'))
  })

  it('skips the pass when research is disabled', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    const summary = await makeWorker({ db, engine: null }).runOnce()
    expect(summary.message).toMatch(/disabled/)
    expect(getIdea(db, id)?.status).toBe('queued')
  })
})

describe('worker history', () => {
  it('hands the title and history to the engine', async () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    const engine = engineOf(async () => researchResult())
    const w = makeWorker({ db, engine })
    await w.runOnce()
    reactToPick(db, getIdea(db, id)!.picks[0].id, { reaction: 'no' })
    requeueIdea(db, id, { requireSignal: false })
    await w.runOnce()

    expect(engine.calls[0].history).toBeNull()
    expect(engine.calls[1].title).toBe('Quiet fan')
    expect(engine.calls[1].history?.mode).toBe('learn')
    expect(engine.calls[1].history?.picks.find((p) => p.reaction === 'no')).toBeDefined()
  })
})
