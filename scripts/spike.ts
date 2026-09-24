import { loadEnv } from '../src/server/env'
import { GeminiEngine } from '../src/server/research/pipeline'

loadEnv()

async function main() {
  const ideaText = process.argv[2] ?? 'A good fan to add to my indoor biking setup'
  const apiKey = process.env.GEMINI_API_KEY

  console.log(`model will be the Gemini free tier (gemini-2.5-flash)\n`)
  if (!apiKey) {
    console.error(
      'error: GEMINI_API_KEY is not set.\n\n' +
        'Get a free key at https://aistudio.google.com/apikey (no credit card), then either\n' +
        '  export GEMINI_API_KEY=...\n' +
        "  or add it to a .env file next to package.json (see .env.example).\n",
    )
    process.exit(1)
  }

  const engine = new GeminiEngine({
    apiKey,
    model: process.env.GEMINI_MODEL ?? 'gemini-2.5-flash',
    maxCandidatesToFetch: 3,
    onProgress: (msg) => console.log(`  ${msg}`),
  })

  console.log(`idea: ${ideaText}\n`)
  console.log('running two-pass research…\n')

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