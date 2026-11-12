import fs from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import type { IdeaList, IdeaPatch, ModelHealth, NewIdea, PickPatch, Preferences, Reaction, ServerStatus } from '../types'
import { PREF_ITEMS_MAX, PREF_ITEM_CHARS, PREF_SUMMARY_CHARS, REASON_MAX, TITLE_MAX } from '../types/limits'
import type { WlDb } from './db'
import {
  BusyError,
  PatchError,
  countQueued,
  createIdea,
  deleteIdea,
  getIdea,
  listIdeas,
  reactToPick,
  requeueIdea,
  updateIdea,
} from './db'
import type { Worker } from './worker'

/** Longest idea text the API accepts (the capture box enforces the same). */
export const MAX_IDEA_LENGTH = 500
export const MAX_NOTES_LENGTH = 500
export const MAX_BUDGET_EUR = 1_000_000
const REACTIONS: readonly Reaction[] = ['no', 'maybe', 'yes']
const LISTS: readonly IdeaList[] = ['wanted', 'bought', 'archived']

export interface AppOptions {
  db: WlDb
  worker: Worker
  /** Env vars that keep research disabled; empty when research is on. */
  missingKeys: string[]
  /** Model chain standing for /api/status; empty when no model is configured. */
  modelHealth?: () => ModelHealth[]
  /** Built client to serve; omitted (or missing on disk) serves the API only. */
  clientDist?: string
}

export function createApp(opts: AppOptions): express.Express {
  const { db, worker } = opts
  const app = express()
  app.disable('x-powered-by')
  app.use(express.json({ limit: '16kb' }))

  app.get('/api/health', (_req, res) => {
    let ok = true
    try {
      db.prepare('SELECT 1').get()
    } catch {
      ok = false
    }
    res.status(ok ? 200 : 500).json({ ok })
  })

  app.get('/api/status', (_req, res) => {
    const status: ServerStatus = {
      ...worker.state(),
      researchEnabled: opts.missingKeys.length === 0,
      missingKeys: opts.missingKeys,
      queuedCount: countQueued(db),
      models: opts.modelHealth?.() ?? [],
    }
    res.json(status)
  })

  app.get('/api/ideas', (_req, res) => {
    res.json(listIdeas(db))
  })

  app.get('/api/ideas/:id', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    const idea = getIdea(db, id)
    if (!idea) return notFound(res)
    res.json(idea)
  })

  app.post('/api/ideas', (req, res) => {
    const parsed = parseNewIdea(req.body)
    if (typeof parsed === 'string') return badRequest(res, parsed)
    const id = createIdea(db, parsed)
    worker.kick()
    res.status(201).json(getIdea(db, id))
  })

  app.patch('/api/ideas/:id', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    const patch = parsePatch(req.body)
    if (typeof patch === 'string') return badRequest(res, patch)
    try {
      const idea = updateIdea(db, id, patch)
      if (!idea) return notFound(res)
      // Back on the wanted list with research still pending: pick it up.
      if (patch.list === 'wanted' && idea.status === 'queued') worker.kick()
      res.json(idea)
    } catch (err) {
      if (err instanceof PatchError) return badRequest(res, err.message)
      if (err instanceof BusyError) return busy(res)
      throw err
    }
  })

  app.delete('/api/ideas/:id', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    if (!deleteIdea(db, id)) return notFound(res)
    res.status(204).end()
  })

  app.patch('/api/picks/:id', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    const patch = parsePickPatch(req.body)
    if (typeof patch === 'string') return badRequest(res, patch)
    const idea = reactToPick(db, id, patch)
    if (!idea) return notFound(res)
    res.json(idea)
  })

  const requeue = (requireSignal: boolean) => (req: Request, res: Response) => {
    const id = ideaId(req, res)
    if (id === null) return
    const outcome = requeueIdea(db, id, { requireSignal })
    if (outcome === null) return notFound(res)
    if (outcome === 'busy') return busy(res)
    if (outcome === 'nothing') return badRequest(res, 'react to a pick or edit the preferences first')
    worker.kick()
    res.status(202).json(getIdea(db, id))
  }
  app.post('/api/ideas/:id/refine', requeue(true))
  app.post('/api/ideas/:id/rerun', requeue(false))

  /** Debug: run a worker pass now and wait for it. */
  app.post('/api/worker/run', async (_req, res) => {
    res.json(await worker.runOnce())
  })

  app.use('/api', (_req, res) => notFound(res))

  serveClient(app, opts.clientDist)

  const onError: ErrorRequestHandler = (err, _req, res, next) => {
    if (res.headersSent) return next(err)
    // body-parser marks malformed or oversized bodies with a 4xx status.
    const status = typeof err?.status === 'number' && err.status >= 400 && err.status < 500 ? err.status : 500
    if (status === 500) console.error('[api]', err)
    res.status(status).json({ error: status === 500 ? 'internal error' : String(err.message) })
  }
  app.use(onError)

  return app
}

function serveClient(app: express.Express, distDir: string | undefined): void {
  if (!distDir) return
  const indexFile = path.join(distDir, 'index.html')
  if (!fs.existsSync(indexFile)) return
  // Vite fingerprints everything under /assets, so those never change; the
  // app shell must always be revalidated so a redeploy shows up on refresh.
  app.use(
    express.static(distDir, {
      setHeaders(res, filePath) {
        res.setHeader(
          'Cache-Control',
          filePath.includes(`${path.sep}assets${path.sep}`)
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        )
      },
    }),
  )
  app.get(/.*/, (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache')
    res.sendFile(indexFile)
  })
}

// ---------------------------------------------------------------------------
// Body validation: each returns the parsed value or an error message.
// ---------------------------------------------------------------------------

type Body = Record<string, unknown>

function asBody(body: unknown): Body {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Body) : {}
}

function parseText(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) return 'text is required'
  if (raw.trim().length > MAX_IDEA_LENGTH) return `text is longer than ${MAX_IDEA_LENGTH} characters`
  return ''
}

/** null clears; a number must be a sensible amount of euros. */
function parseBudget(raw: unknown): number | null | string {
  if (raw === null || raw === '') return null
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0 || raw > MAX_BUDGET_EUR) {
    return `budget must be a number of euros between 0 and ${MAX_BUDGET_EUR}`
  }
  return Math.round(raw * 100) / 100
}

function parseNotes(raw: unknown): string | null | { error: string } {
  if (raw === null) return null
  if (typeof raw !== 'string') return { error: 'notes must be text' }
  if (raw.trim().length > MAX_NOTES_LENGTH) return { error: `notes are longer than ${MAX_NOTES_LENGTH} characters` }
  return raw.trim() || null
}

function parseNewIdea(body: unknown): NewIdea | string {
  const b = asBody(body)
  const textError = parseText(b.text)
  if (textError) return textError
  const idea: NewIdea = { text: (b.text as string).trim() }
  if (b.budget !== undefined) {
    const budget = parseBudget(b.budget)
    if (typeof budget === 'string') return budget
    idea.budget = budget
  }
  if (b.notes !== undefined) {
    const notes = parseNotes(b.notes)
    if (notes && typeof notes === 'object') return notes.error
    idea.notes = notes
  }
  return idea
}

function parsePatch(body: unknown): IdeaPatch | string {
  const b = asBody(body)
  const patch: IdeaPatch = {}
  if (b.text !== undefined) {
    const textError = parseText(b.text)
    if (textError) return textError
    patch.text = (b.text as string).trim()
  }
  if (b.budget !== undefined) {
    const budget = parseBudget(b.budget)
    if (typeof budget === 'string') return budget
    patch.budget = budget
  }
  if (b.notes !== undefined) {
    const notes = parseNotes(b.notes)
    if (notes && typeof notes === 'object') return notes.error
    patch.notes = notes
  }
  if (b.list !== undefined) {
    if (!LISTS.includes(b.list as IdeaList)) return `list must be one of ${LISTS.join(', ')}`
    patch.list = b.list as IdeaList
  }
  if (b.boughtPickId !== undefined) {
    if (patch.list !== 'bought') return 'boughtPickId goes with list "bought"'
    if (b.boughtPickId !== null && !Number.isSafeInteger(b.boughtPickId)) return 'boughtPickId must be a pick id'
    patch.boughtPickId = b.boughtPickId as number | null
  }
  if (b.title !== undefined) {
    const title = parseTitle(b.title)
    if (title !== null && typeof title === 'object') return title.error
    patch.title = title
  }
  if (b.preferences !== undefined) {
    const prefs = parsePreferences(b.preferences)
    if ('error' in prefs) return prefs.error
    patch.preferences = prefs
  }
  if (Object.keys(patch).length === 0) return 'nothing to change'
  return patch
}

function parsePickPatch(body: unknown): PickPatch | string {
  const b = asBody(body)
  const patch: PickPatch = {}
  if (b.reaction !== undefined) {
    if (b.reaction !== null && !REACTIONS.includes(b.reaction as Reaction)) {
      return `reaction must be one of ${REACTIONS.join(', ')} or null`
    }
    patch.reaction = b.reaction as Reaction | null
  }
  if (b.reason !== undefined) {
    if (b.reason !== null && typeof b.reason !== 'string') return 'reason must be text'
    if (typeof b.reason === 'string' && b.reason.trim().length > REASON_MAX) {
      return `reason is longer than ${REASON_MAX} characters`
    }
    patch.reason = typeof b.reason === 'string' ? b.reason.trim() || null : null
  }
  if (Object.keys(patch).length === 0) return 'nothing to change'
  return patch
}

/** A string names the idea; null hands the name back to the model. */
function parseTitle(raw: unknown): string | null | { error: string } {
  if (raw === null) return null
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > TITLE_MAX) {
    return { error: `title must be 1 to ${TITLE_MAX} characters` }
  }
  return raw.trim()
}

const PREF_LISTS = ['mustHaves', 'avoid', 'likes'] as const

function parsePreferences(raw: unknown): Preferences | { error: string } {
  const b = asBody(raw)
  const bad = { error: 'preferences need a summary and the lists mustHaves, avoid and likes' }
  if (typeof b.summary !== 'string' || b.summary.trim().length > PREF_SUMMARY_CHARS) return bad
  const prefs: Preferences = { summary: b.summary.trim(), mustHaves: [], avoid: [], likes: [] }
  for (const key of PREF_LISTS) {
    const items = b[key]
    if (!Array.isArray(items) || items.length > PREF_ITEMS_MAX) return bad
    for (const item of items) {
      if (typeof item !== 'string' || !item.trim() || item.trim().length > PREF_ITEM_CHARS) return bad
      prefs[key].push(item.trim())
    }
  }
  return prefs
}

function ideaId(req: Request, res: Response): number | null {
  const id = Number(req.params.id)
  if (!Number.isSafeInteger(id) || id <= 0) {
    badRequest(res, 'bad id')
    return null
  }
  return id
}

function badRequest(res: Response, error: string): void {
  res.status(400).json({ error })
}

function busy(res: Response): void {
  res.status(409).json({ error: 'a round is in progress' })
}

function notFound(res: Response): void {
  res.status(404).json({ error: 'not found' })
}
