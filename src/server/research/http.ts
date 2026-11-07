import type { UrlStatus } from '../../types'
import { decodeEntities, extractProductData, type ProductData } from './product'

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

const TIMEOUT_MS = 12_000
/** Product pages are large; the useful parts sit well inside this. Keeps a Pi's memory safe. */
const MAX_BODY_BYTES = 1_500_000
const MAX_TEXT_CHARS = 12_000

export interface Page {
  /**
   * dead: gone for sure (404/410, or bounced to the home page or a "not
   * found" page). unknown: could not tell (bot wall, 5xx, network).
   */
  status: UrlStatus
  title: string
  text: string
  product: ProductData | null
}

const UNKNOWN: Page = { status: 'unknown', title: '', text: '', product: null }

/**
 * One GET per page serves liveness, the text the verify step reads, and the
 * shop's own product data (price, stock, photo). Never throws.
 */
export async function fetchPage(url: string): Promise<Page> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': UA,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'nl-BE,nl;q=0.9,fr-BE;q=0.8,en;q=0.7',
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    return UNKNOWN
  }

  if (res.status === 404 || res.status === 410) return { ...UNKNOWN, status: 'dead' }
  // 401/403/429 are bot walls on big shops, 5xx is the shop's problem: the
  // product may well exist, so neither counts as dead.
  if (!res.ok) {
    void res.body?.cancel().catch(() => {})
    return UNKNOWN
  }
  if (bouncedToHome(url, res)) {
    void res.body?.cancel().catch(() => {})
    return { ...UNKNOWN, status: 'dead' }
  }

  const type = res.headers.get('content-type') ?? ''
  if (type && !/html|xml/i.test(type)) {
    void res.body?.cancel().catch(() => {})
    return { ...UNKNOWN, status: 'live' }
  }

  let html: string
  try {
    html = await readCapped(res, MAX_BODY_BYTES)
  } catch {
    return { ...UNKNOWN, status: 'live' }
  }
  const title = extractTitle(html)
  if (looksNotFound(title)) return { ...UNKNOWN, status: 'dead' }
  return {
    status: 'live',
    title,
    text: extractText(html),
    product: extractProductData(html, res.url || url),
  }
}

/** A removed product often redirects to the shop's home page instead of 404ing. */
function bouncedToHome(requested: string, res: Response): boolean {
  if (!res.redirected || !res.url) return false
  try {
    const from = new URL(requested)
    const to = new URL(res.url)
    return from.pathname.length > 1 && (to.pathname === '/' || to.pathname === '')
  } catch {
    return false
  }
}

function looksNotFound(title: string): boolean {
  return /\b404\b|page not found|pagina niet gevonden|niet gevonden|page introuvable|seite nicht gefunden/i.test(
    title,
  )
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  if (!res.body) return ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: false })
  let out = ''
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    out += decoder.decode(value, { stream: true })
    if (bytes >= maxBytes) {
      await reader.cancel().catch(() => {})
      break
    }
  }
  return out + decoder.decode()
}

export function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  if (!m) return ''
  return decodeEntities(m[1]).replace(/\s+/g, ' ').trim().slice(0, 200)
}

/**
 * Visible text for the verify step: comments, scripts, styles and page chrome
 * (nav, header, footer, aside) removed, and the <main> element preferred when
 * the page has a substantial one.
 */
export function extractText(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'iframe']) {
    s = s.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(s)?.[0]
  if (main && toText(main).length > 400) s = main
  for (const tag of ['nav', 'header', 'footer', 'aside']) {
    s = s.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  return toText(s).slice(0, MAX_TEXT_CHARS)
}

function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
