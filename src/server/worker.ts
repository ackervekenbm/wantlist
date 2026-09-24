import type { ResearchEngine } from '../types'
import type { WlDb } from './db'
import { getIdea, queuedIdeaIds, replacePicks, setIdeaStatus } from './db'

export interface Worker {
  runOnce(): Promise<WorkerRunSummary>
  stop(): void
  status(): { running: boolean; lastRunAt: string | null; lastRunResult: string | null }
}

export interface WorkerOptions {
  db: WlDb
  engine: ResearchEngine | null
  intervalMs: number
  queueCap: number
  log?: (line: string) => void
}

export interface WorkerRunSummary {
  attempted: number
  succeeded: number
  failed: number
  queuedRemaining: number
  message: string
}

const statusMemo = {
  running: false,
  lastRunAt: null as string | null,
  lastRunResult: null as string | null,
}

export function createWorker(opts: WorkerOptions): Worker {
  const log = opts.log ?? ((line) => console.log(`[worker] ${line}`))
  let timer: NodeJS.Timeout | null = null

  async function runOnce(): Promise<WorkerRunSummary> {
    if (statusMemo.running) {
      return { attempted: 0, succeeded: 0, failed: 0, queuedRemaining: 0, message: 'already running' }
    }
    statusMemo.running = true
    statusMemo.lastRunAt = new Date().toISOString()
    try {
      if (!opts.engine) {
        statusMemo.lastRunResult = 'no research engine (GEMINI_API_KEY not set) - skipped'
        return { attempted: 0, succeeded: 0, failed: 0, queuedRemaining: 0, message: statusMemo.lastRunResult }
      }
      const ids = queuedIdeaIds(opts.db, opts.queueCap)
      const summary: WorkerRunSummary = {
        attempted: ids.length,
        succeeded: 0,
        failed: 0,
        queuedRemaining: 0,
        message: '',
      }
      log(`run: ${ids.length} idea(s) queued`)

      for (const id of ids) {
        try {
          setIdeaStatus(opts.db, id, 'researching')
          const idea = getIdea(opts.db, id)
          if (!idea) continue
          log(`researching idea ${id} (${idea.text.slice(0, 60)})`)
          const picks = await opts.engine.research({ ideaId: id, text: idea.text })
          replacePicks(
            opts.db,
            id,
            picks.map((p) => ({
              ...p,
              ideaId: id,
              id: 0,
              sourceUrls: [],
              fetchedAt: new Date().toISOString(),
            })),
          )
          if (picks.length === 0) {
            setIdeaStatus(opts.db, id, 'error', 'Research returned no live picks')
            summary.failed += 1
          } else {
            setIdeaStatus(opts.db, id, 'done')
            summary.succeeded += 1
          }
        } catch (err) {
          const message = (err as Error).message
          log(`idea ${id} failed: ${message}`)
          setIdeaStatus(opts.db, id, 'error', message)
          summary.failed += 1
        }
      }

      summary.queuedRemaining = queuedIdeaIds(opts.db, 1_000_000).length
      summary.message = `done: ${summary.succeeded} ok, ${summary.failed} failed`
      statusMemo.lastRunResult = summary.message
      log(summary.message)
      return summary
    } catch (err) {
      const message = `run aborted: ${(err as Error).message}`
      statusMemo.lastRunResult = message
      log(message)
      return { attempted: 0, succeeded: 0, failed: 0, queuedRemaining: 0, message }
    } finally {
      statusMemo.running = false
    }
  }

  function stop(): void {
    if (timer) clearInterval(timer)
    timer = null
  }

  if (opts.intervalMs > 0) {
    timer = setInterval(() => {
      void runOnce().catch((err) => log(`scheduled run error: ${(err as Error).message}`))
    }, opts.intervalMs)
  }

  return { runOnce, stop, status: () => statusMemo }
}