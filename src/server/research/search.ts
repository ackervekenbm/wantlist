import { normalizeUrl } from './gemini'
import { ModelError } from './llm'

export type { CandidateInputRow } from './gemini'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchProvider {
  search(query: string, opts?: { region?: string }): Promise<SearchResult[]>
}

export class SerperProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: { region?: string } = {}): Promise<SearchResult[]> {
    const res = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': this.apiKey,
      },
      body: JSON.stringify({
        q: query,
        gl: opts.region ?? 'be',
        hl: 'en',
        num: 10,
      }),
    })
    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      const retryable = res.status === 429 || res.status >= 500
      throw new ModelError(
        `serper HTTP ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`,
        res.status,
        retryable,
        res.status === 429 ? 10_000 : null,
        res.status === 429,
      )
    }
    const json = (await res.json()) as SerperResponse

    const out: SearchResult[] = []
    const push = (title: unknown, url: unknown, snippet: unknown) => {
      if (typeof title !== 'string' || typeof url !== 'string') return
      if (!/^https?:\/\//.test(url)) return
      out.push({ title, url, snippet: typeof snippet === 'string' ? snippet : '' })
    }

    for (const r of json.organic ?? []) push(r.title, r.link, r.snippet)
    for (const s of json.shopping ?? []) push(s.title, s.link ?? s.imageUrl, s.snippet)

    const seen = new Set<string>()
    return out
      .filter((r) => {
        const key = normalizeUrl(r.url)
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 20)
  }
}

interface SerperResponse {
  organic?: Array<{ title?: string; link?: string; snippet?: string }>
  shopping?: Array<{ title?: string; link?: string; imageUrl?: string; snippet?: string }>
}