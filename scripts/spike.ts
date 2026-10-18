import { loadEnv } from '../src/server/env'
import { buildModelRouter } from '../src/server/research/chain'
import { PipelineEngine } from '../src/server/research/pipeline'
import { SerperProvider } from '../src/server/research/search'

loadEnv()

async function main() {
  const ideaText = process.argv[2] ?? 'A good fan to add to my indoor biking setup'
  const serperKey = process.env.SERPER_API_KEY
  const onProgress = (msg: string) => console.log(`  ${msg}`)
  const router = buildModelRouter(process.env, onProgress)

  if (!router || !serperKey) {
    console.error(
      'error: missing API key(s).\n\n' +
        '  GEMINI_API_KEY  https://aistudio.google.com/apikey          (free, no card)\n' +
        '  SERPER_API_KEY  https://serper.dev                           (free: 2,500 one-time search credits)\n' +
        '  GROQ_API_KEY    https://console.groq.com/keys                (optional fallback, free, no card)\n\n' +
        "Set them in your environment or in a .env file (see .env.example).\n",
    )
    process.exit(1)
  }

  const engine = new PipelineEngine({
    router,
    search: new SerperProvider(serperKey),
    maxCandidatesToFetch: 3,
    onProgress,
  })

  console.log(`chain: ${router.ids.join(' -> ')} (free tier, no grounding)\n`)
  console.log(`idea: ${ideaText}\n`)
  console.log('running plan -> search -> candidates -> page reads -> verify -> liveness…\n')

  const starts = Date.now()
  const picks = await engine.research({ ideaId: 0, text: ideaText })
  const seconds = ((Date.now() - starts) / 1000).toFixed(1)

  if (picks.length === 0) {
    console.log(`no picks survived (${seconds}s).`)
    process.exitCode = 1
    return
  }

  console.log(JSON.stringify(picks, null, 2))
  console.log(`\n${picks.length} pick(s) in ${seconds}s.`)
}

main().catch((err) => {
  console.error(`spike failed:`, err instanceof Error ? err.message : err)
  process.exit(1)
})
