import type { ResearchEngine, ServerStatus } from '../types'
import type { WlDb } from './db'
import {
  claimIdea,
  completeIdea,
  dueIdeaIds,
  failIdea,
  getIdea,
  nextScheduledAttempt,
} from './db'
import { ResearchError } from './research/errors'
import { buildHistory } from './history'

export interface RetryPolicy {
  /** First retry delay; doubles per failed attempt. */
  baseMs: number
  /** Ceiling for the doubling. */
  maxMs: number
  /** Failed attempts after which the idea stops at `error`. */
  maxAttempts: number
}

export const DEFAULT_RETRY: RetryPolicy = {
  baseMs: 15 * 60 * 1000,
  maxMs: 6 * 60 * 60 * 1000,
  maxAttempts: 5,
}

export interface WorkerOptions {
  db: WlDb
  engine: ResearchEngine | null
  /** Longest idle gap between passes; scheduled retries wake it earlier. */
  intervalMs: number
  /** Ideas per pass. */
  queueCap: number
  retry?: RetryPolicy
  log?: (line: string) => void
  now?: () => Date
}

export interface WorkerRunSummary {
  attempted: number
  succeeded: number
  failed: number
  retrying: number
  message: string
}

export type WorkerState = Pick<ServerStatus, 'running' | 'lastRunAt' | 'lastRunResult' | 'current'>

export interface Worker {
  /** One pass over the due queue. Resolves with what it did. */
  runOnce(): Promise<WorkerRunSummary>
  /**
   * Ask for a pass soon without waiting for it. When a pass is already
   * running, another one follows it, so new work never waits an interval.
   */
  kick(): void
  /** Starts the timer (idle polling + scheduled retries). */
  start(): void
  stop(): void
  state(): WorkerState
}

/**
 * Decides whether a failure is worth another automatic attempt, and when.
 * Returns null for permanent failures and once the attempt budget is spent.
 * `attempt` counts the failure being handled (1 = first failure).
 */
export function retryAt(err: unknown, attempt: number, now: Date, policy: RetryPolicy): Date | null {
  if (!(err instanceof ResearchError) || !err.retryable) return null
  if (attempt >= policy.maxAttempts) return null
  const backoff = Math.min(policy.baseMs * 2 ** (attempt - 1), policy.maxMs)
  // A quota block says exactly when capacity returns; never retry sooner.
  const delay = err.retryAfterMs && err.retryAfterMs > 0 ? Math.max(err.retryAfterMs, backoff) : backoff
  return new Date(now.getTime() + delay)
}

export function createWorker(opts: WorkerOptions): Worker {
  const log = opts.log ?? ((line) => console.log(`[worker] ${line}`))
  const now = opts.now ?? (() => new Date())
  const policy = opts.retry ?? DEFAULT_RETRY

  const state: WorkerState = { running: false, lastRunAt: null, lastRunResult: null, current: null }
  let pending = false
  let timer: NodeJS.Timeout | null = null
  let started = false

  const empty = (message: string): WorkerRunSummary => ({
    attempted: 0,
    succeeded: 0,
    failed: 0,
    retrying: 0,
    message,
  })

  async function runOnce(): Promise<WorkerRunSummary> {
    if (state.running) {
      pending = true
      return empty('already running; another pass will follow')
    }
    state.running = true
    state.lastRunAt = now().toISOString()
    try {
      const summary = await pass()
      state.lastRunResult = summary.message
      if (summary.attempted > 0) log(summary.message)
      return summary
    } catch (err) {
      const message = `pass aborted: ${(err as Error).message}`
      state.lastRunResult = message
      log(message)
      return empty(message)
    } finally {
      state.running = false
      state.current = null
      if (pending) {
        pending = false
        kick()
      } else {
        schedule()
      }
    }
  }

  async function pass(): Promise<WorkerRunSummary> {
    const engine = opts.engine
    if (!engine) return empty('research disabled (API keys missing); skipped')

    const ids = dueIdeaIds(opts.db, opts.queueCap, now())
    const summary = { ...empty(''), attempted: ids.length }

    for (const id of ids) {
      if (!claimIdea(opts.db, id)) continue
      const idea = getIdea(opts.db, id)
      if (!idea) continue
      state.current = { ideaId: id, step: 'starting' }
      log(`researching #${id}: ${idea.text.slice(0, 60)}`)

      try {
        const result = await engine.research({
          ideaId: id,
          text: idea.text,
          budget: idea.budget,
          notes: idea.notes,
          title: idea.title,
          history: buildHistory(idea),
          onProgress: (step) => {
            if (state.current?.ideaId === id) state.current = { ideaId: id, step }
          },
        })
        if (result.picks.length === 0) {
          failIdea(opts.db, id, 'No product survived verification. Try rewording the idea.', null, 'nothing-new')
          summary.failed += 1
        } else if (completeIdea(opts.db, id, result, now())) {
          summary.succeeded += 1
        }
      } catch (err) {
        const message = (err as Error).message
        const at = retryAt(err, idea.attempts + 1, now(), policy)
        const kind = at ? null : err instanceof ResearchError && err.kind === 'no-results' ? 'nothing-new' : 'stopped'
        failIdea(opts.db, id, message, at, kind)
        log(`#${id} failed${at ? `, retrying at ${at.toISOString()}` : ''}: ${message}`)
        if (at) summary.retrying += 1
        else summary.failed += 1
        // Every model is out of quota: the rest of this pass would fail too.
        if (err instanceof ResearchError && err.allModelsOut) break
      }
    }

    summary.message = `${summary.succeeded} done, ${summary.retrying} retrying, ${summary.failed} failed`
    return summary
  }

  function kick(): void {
    void runOnce()
  }

  /** Sleep until the next scheduled retry, or the idle interval, whichever is first. */
  function schedule(): void {
    if (!started) return
    if (timer) clearTimeout(timer)
    let delay = opts.intervalMs > 0 ? opts.intervalMs : Infinity
    const next = nextScheduledAttempt(opts.db, now())
    if (next) delay = Math.min(delay, Math.max(next.getTime() - now().getTime(), 1000))
    if (!Number.isFinite(delay)) return
    // setTimeout overflows above ~24.8 days; an interval wake-up re-plans anyway.
    timer = setTimeout(kick, Math.min(delay, 2 ** 31 - 1))
    timer.unref()
  }

  return {
    runOnce,
    kick,
    start() {
      started = true
      schedule()
    },
    stop() {
      started = false
      if (timer) clearTimeout(timer)
      timer = null
    },
    state: () => ({ ...state, current: state.current ? { ...state.current } : null }),
  }
}
