import { ResearchError, retryAfterHeaderMs } from './errors'
import { normalizeUrl } from './offers'

export interface SearchResult {
  title: string
  url: string
  snippet: string
}

export interface SearchProvider {
  search(query: string, opts?: { region?: string }): Promise<SearchResult[]>
}

const TIMEOUT_MS = 20_000

export class SerperProvider implements SearchProvider {
  constructor(private readonly apiKey: string) {}

  async search(query: string, opts: { region?: string } = {}): Promise<SearchResult[]> {
    let res: Response
    try {
      res = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-KEY': this.apiKey },
        body: JSON.stringify({ q: query, gl: opts.region ?? 'be', hl: 'en', num: 10 }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch (err) {
      throw new ResearchError(`search failed (${(err as Error).message})`, { kind: 'transient' })
    }
    if (!res.ok) throw await serperError(res)

    const json = (await res.json()) as SerperResponse
    const out: SearchResult[] = []
    const push = (title: unknown, url: unknown, snippet: string) => {
      if (typeof title !== 'string' || typeof url !== 'string') return
      if (!/^https?:\/\//.test(url)) return
      out.push({ title, url, snippet })
    }

    for (const r of json.organic ?? []) push(r.title, r.link, typeof r.snippet === 'string' ? r.snippet : '')
    // Shopping slots: the link is the offer page, never the image; source and
    // price are what the snippet would otherwise lack.
    for (const s of json.shopping ?? []) {
      const parts = [s.source, s.price, s.snippet].filter((x): x is string => typeof x === 'string' && x !== '')
      push(s.title, s.link, parts.join(' · '))
    }

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

async function serperError(res: Response): Promise<ResearchError> {
  const detail = (await res.text().catch(() => '')).slice(0, 200)
  const suffix = detail ? `: ${detail}` : ''
  if (res.status === 429 || res.status >= 500) {
    return new ResearchError(`search unavailable (Serper HTTP ${res.status})${suffix}`, {
      kind: 'transient',
      status: res.status,
      retryAfterMs: retryAfterHeaderMs(res) ?? (res.status === 429 ? 10_000 : null),
    })
  }
  // 401/403: bad key. Serper answers spent credits with a 400 "Not enough credits".
  if (res.status === 401 || res.status === 403 || /credit/i.test(detail)) {
    return new ResearchError(
      `Serper refused the search (HTTP ${res.status}): check SERPER_API_KEY and the credits left at serper.dev${suffix}`,
      { kind: 'unavailable', status: res.status },
    )
  }
  return new ResearchError(`search rejected (Serper HTTP ${res.status})${suffix}`, {
    kind: 'invalid',
    status: res.status,
  })
}

interface SerperResponse {
  organic?: Array<{ title?: string; link?: string; snippet?: string }>
  shopping?: Array<{ title?: string; link?: string; source?: string; price?: string; snippet?: string }>
}
