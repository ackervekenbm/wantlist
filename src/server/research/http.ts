import type { UrlStatus } from '../../types'
import { isListingUrl, normalizeUrl } from './offers'
import { decodeEntities, extractProductData, pageKindOf, type PageKind, type ProductData } from './product'

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
  /** Set when the page is a category, search or article page rather than one product's shop page. */
  kind?: PageKind
  /** Shop pages this page's affiliate links lead to (see `referralTargets`). */
  referrals?: string[]
  /** On a listing: the products it links to, for browsing it (see `listingLinks`). */
  links?: PageLink[]
}

/** A link on a category page, named by its own text. */
export interface PageLink {
  title: string
  url: string
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
  const text = extractText(html)
  if (looksLikeBotCheck(title, text)) return UNKNOWN
  let kind = isListingUrl(res.url || url) ? 'listing' : pageKindOf(html)
  // A list's product data is its first entry's, not the page's.
  let product = kind ? null : extractProductData(html, res.url || url)
  // A category page the shop did not mark up as one: no price of its own, one per product in the text.
  if (!product?.price && manyPrices(text)) {
    kind = 'listing'
    product = null
  }
  return {
    status: 'live',
    title,
    text,
    product,
    ...(kind && { kind }),
    ...(kind === 'listing' && { links: listingLinks(html, res.url || url) }),
    referrals: referralTargets(html, res.url || url),
  }
}

/** Distinct euro amounts that make a page with no price of its own a list: a product page with a few related items stays well below. */
const LISTING_PRICES = 12
const manyPrices = (text: string): boolean => new Set(text.match(/€\s?\d[\d.,]*|\d[\d.,]*\s?€/g)).size >= LISTING_PRICES

const MAX_LINKS = 40

/**
 * What a category page links to on its own site, with a name (the link text,
 * else its title or image alt), never another listing. Links below the page's
 * own path (`/spiegels/<product>`) come first; the shortlist model tells
 * products from menu links.
 */
export function listingLinks(html: string, pageUrl: string): PageLink[] {
  let base: URL
  try {
    base = new URL(pageUrl)
  } catch {
    return []
  }
  const site = siteOf(base.hostname)
  const self = normalizeUrl(pageUrl)
  const below = `${base.pathname.replace(/\/+$/, '')}/`
  const found = new Map<string, PageLink & { score: number }>()
  // Menus, headers and footers are left out with the rest of the chrome.
  for (const m of contentHtml(html).matchAll(/<a\s([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = /href\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1]
    if (!href) continue
    let link: URL
    try {
      link = new URL(decodeEntities(href), base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(link.protocol) || siteOf(link.hostname) !== site || isListingUrl(link.href)) continue
    const key = normalizeUrl(link.href)
    if (key === self || found.has(key)) continue
    const named =
      m[2].replace(/<[^>]+>/g, ' ').trim() ||
      /title\s*=\s*["']([^"']+)["']/i.exec(m[1])?.[1] ||
      /alt\s*=\s*["']([^"']+)["']/i.exec(m[2])?.[1] ||
      ''
    const title = decodeEntities(named).replace(/\s+/g, ' ').trim()
    if (title.length < 6) continue
    link.hash = ''
    // A product's slug names it in several words (`hovet-spiegel-zwart-70515915`); a menu link's rarely does.
    const slug = link.pathname.split('/').filter(Boolean).at(-1) ?? ''
    const score = (link.pathname.startsWith(below) ? 2 : 0) + (slug.split(/[-_]/).length >= 3 ? 1 : 0)
    found.set(key, { title: title.slice(0, 120), url: link.href, score })
  }
  return [...found.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LINKS)
    .map(({ title, url }) => ({ title, url }))
}

const MAX_REFERRALS = 3
const IMAGE = /\.(jpe?g|png|gif|webp|avif|svg)$/i
/** "www.shop.be" and "cdn.shop.be" are one site. */
const siteOf = (host: string): string => host.toLowerCase().split('.').slice(-2).join('.')

/**
 * Product pages on other sites that this page's links carry in their query,
 * the way affiliate links do (`partner.bol.com/click?…&url=https://www.bol.com/…/p/…`).
 * Share buttons (they carry this page), images, listings and home pages are left out.
 */
export function referralTargets(html: string, pageUrl: string): string[] {
  let site: string
  try {
    site = siteOf(new URL(pageUrl).hostname)
  } catch {
    return []
  }
  const out = new Set<string>()
  for (const m of html.matchAll(/<a\s[^>]*href\s*=\s*["']([^"']+)["']/gi)) {
    let link: URL
    try {
      link = new URL(decodeEntities(m[1]), pageUrl)
    } catch {
      continue
    }
    for (const value of link.searchParams.values()) {
      if (!/^https?:\/\//i.test(value)) continue
      try {
        const to = new URL(value)
        if (siteOf(to.hostname) === site || to.pathname.length <= 1 || IMAGE.test(to.pathname) || isListingUrl(to.href)) continue
        out.add(to.href)
      } catch {
        // not a URL after all
      }
    }
    if (out.size >= MAX_REFERRALS) break
  }
  return [...out].slice(0, MAX_REFERRALS)
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

/** A "checking if you're human" page stands in for the shop page: nothing on it is the shop's. */
function looksLikeBotCheck(title: string, text: string): boolean {
  // Only short pages: a real product page may mention reCAPTCHA in its footer.
  if (text.length > 1500) return false
  return /checking if you('|’)?re (a )?human|verify(ing)? (that )?you are (a )?human|human verification|just a moment\.\.\.|attention required|are you a robot|ben je een robot|enable javascript and cookies to continue/i.test(
    `${title} ${text}`,
  )
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
  return toText(contentHtml(html)).slice(0, MAX_TEXT_CHARS)
}

/** The page without comments, scripts, styles and chrome: <main> when it is substantial. */
function contentHtml(html: string): string {
  let s = html.replace(/<!--[\s\S]*?-->/g, ' ')
  for (const tag of ['script', 'style', 'noscript', 'svg', 'template', 'iframe']) {
    s = s.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(s)?.[0]
  if (main && toText(main).length > 400) s = main
  for (const tag of ['nav', 'header', 'footer', 'aside']) {
    s = s.replace(new RegExp(`<${tag}[\\s>][\\s\\S]*?<\\/${tag}>`, 'gi'), ' ')
  }
  return s
}

function toText(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}
