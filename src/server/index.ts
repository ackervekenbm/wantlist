import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import { env, envInt, loadEnv } from './env'
import { openDb } from './db'
import { createWorker } from './worker'
import { GeminiEngine } from './research/pipeline'
import {
  createIdea,
  deleteIdea,
  getIdea,
  listIdeas,
  requeueIdea,
} from './db'

loadEnv()

const app = express()
app.use(express.json())

const db = openDb(env('DATA_DIR', path.join(process.cwd(), 'data')))
const apiKey = process.env.GEMINI_API_KEY
const engine = apiKey
  ? new GeminiEngine({ apiKey, model: env('GEMINI_MODEL', 'gemini-2.5-flash') })
  : null

const worker = createWorker({
  db,
  engine,
  intervalMs: envInt('WORKER_INTERVAL_MS', 15 * 60 * 1000),
  queueCap: envInt('WORKER_QUEUE_CAP', 3),
})

// --- API ---
app.get('/api/health', (_req, res) => {
  res.json({ ok: true })
})

app.get('/api/status', (_req, res) => {
  const queued = db
    .prepare(`SELECT COUNT(*) AS n FROM ideas WHERE status IN ('queued','error')`)
    .get() as { n: number }
  res.json({ ...worker.status(), queuedCount: queued.n })
})

app.get('/api/ideas', (_req, res) => {
  res.json(listIdeas(db))
})

app.get('/api/ideas/:id', (req, res) => {
  const id = Number(req.params.id)
  const idea = Number.isInteger(id) ? getIdea(db, id) : null
  if (!idea) return res.status(404).json({ error: 'not found' })
  res.json(idea)
})

app.post('/api/ideas', (req, res) => {
  const text = String(req.body?.text ?? '').trim()
  if (!text) return res.status(400).json({ error: 'text is required' })
  const id = createIdea(db, text)
  void worker.runOnce().catch(() => undefined)
  res.status(201).json({ id: String(id), text, status: 'queued' })
})

app.delete('/api/ideas/:id', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  deleteIdea(db, id)
  res.status(204).end()
})

app.post('/api/ideas/:id/rerun', (req, res) => {
  const id = Number(req.params.id)
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'bad id' })
  requeueIdea(db, id)
  void worker.runOnce().catch(() => undefined)
  res.json({ ok: true })
})

app.post('/api/worker/run', async (_req, res) => {
  const result = await worker.runOnce()
  res.json(result)
})

// --- static client ---
const distDir = path.join(process.cwd(), 'dist')
const indexFile = path.join(distDir, 'index.html')
if (fs.existsSync(indexFile)) {
  app.use(express.static(distDir))
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(indexFile)
  })
}

const host = env('HOST', '0.0.0.0')
const port = envInt('PORT', 3000)
app.listen(port, host, () => {
  console.log(`wantlist listening on http://${host}:${port}`)
  if (!engine) {
    console.log('warning: GEMINI_API_KEY not set - research worker is disabled')
  }
  // One immediate run at boot to clear anything left queued from a restart.
  setTimeout(() => void worker.runOnce(), 1500)
})