import path from 'node:path'
import { createApp } from './app'
import { openDb, recoverInterrupted } from './db'
import { env, envInt, loadEnv } from './env'
import { buildModelRouter } from './research/chain'
import { PipelineEngine } from './research/pipeline'
import { SerperProvider } from './research/search'
import { createWorker } from './worker'

loadEnv()

const db = openDb(env('DATA_DIR', path.join(process.cwd(), 'data')))
const recovered = recoverInterrupted(db)
if (recovered > 0) console.log(`[worker] requeued ${recovered} idea(s) interrupted by a restart`)

const serperKey = process.env.SERPER_API_KEY
const router = buildModelRouter(process.env, (msg) => console.log(`[llm] ${msg}`))
const missingKeys = [
  router ? null : 'GEMINI_API_KEY',
  serperKey ? null : 'SERPER_API_KEY',
].filter((k): k is string => k !== null)

const engine =
  router && serperKey
    ? new PipelineEngine({
        router,
        search: new SerperProvider(serperKey),
        onProgress: (msg) => console.log(`[research] ${msg}`),
      })
    : null

const worker = createWorker({
  db,
  engine,
  intervalMs: envInt('WORKER_INTERVAL_MS', 15 * 60 * 1000),
  queueCap: envInt('WORKER_QUEUE_CAP', 3),
})

const app = createApp({
  db,
  worker,
  missingKeys,
  modelHealth: () => router?.health() ?? [],
  clientDist: path.join(process.cwd(), 'dist'),
})

const host = env('HOST', '0.0.0.0')
const port = envInt('PORT', 3000)
const server = app.listen(port, host, () => {
  console.log(`wantlist listening on http://${host}:${port}`)
  if (engine) {
    console.log(`[llm] chain: ${router?.ids.join(' -> ')}`)
  } else {
    console.log(`warning: ${missingKeys.join(' + ')} not set - research is disabled`)
  }
  worker.start()
  // Clear anything left queued by a restart.
  worker.kick()
})

let shuttingDown = false

function shutdown(signal: string): void {
  if (shuttingDown) return
  shuttingDown = true
  console.log(`${signal} received, shutting down`)
  worker.stop()
  server.close(() => {
    // An idea still mid-research stays `researching`; the next boot requeues it.
    db.close()
    process.exit(0)
  })
  // Polling clients hold keep-alive sockets open; drop the idle ones.
  server.closeIdleConnections()
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
