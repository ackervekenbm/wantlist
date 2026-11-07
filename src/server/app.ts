import fs from 'node:fs'
import path from 'node:path'
import express, { type ErrorRequestHandler, type Request, type Response } from 'express'
import type { ServerStatus } from '../types'
import type { WlDb } from './db'
import { countQueued, createIdea, deleteIdea, getIdea, listIdeas, requeueIdea } from './db'
import type { Worker } from './worker'

/** Longest idea text the API accepts (the capture box enforces the same). */
export const MAX_IDEA_LENGTH = 500

export interface AppOptions {
  db: WlDb
  worker: Worker
  /** Env vars that keep research disabled; empty when research is on. */
  missingKeys: string[]
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
    const raw: unknown = req.body?.text
    const text = typeof raw === 'string' ? raw.trim() : ''
    if (!text) return badRequest(res, 'text is required')
    if (text.length > MAX_IDEA_LENGTH) {
      return badRequest(res, `text is longer than ${MAX_IDEA_LENGTH} characters`)
    }
    const id = createIdea(db, text)
    worker.kick()
    res.status(201).json(getIdea(db, id))
  })

  app.delete('/api/ideas/:id', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    if (!deleteIdea(db, id)) return notFound(res)
    res.status(204).end()
  })

  app.post('/api/ideas/:id/rerun', (req, res) => {
    const id = ideaId(req, res)
    if (id === null) return
    const idea = getIdea(db, id)
    if (!idea) return notFound(res)
    if (!requeueIdea(db, id)) {
      return res.status(409).json({ error: 'this idea is being researched right now' })
    }
    worker.kick()
    res.status(202).json(getIdea(db, id))
  })

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

function notFound(res: Response): void {
  res.status(404).json({ error: 'not found' })
}
