import type { Availability, Rating } from '../../types'

/**
 * What a shop page says about its product in machine-readable form:
 * schema.org JSON-LD first (nearly every shop ships it for Google Shopping),
 * OpenGraph / product meta tags as a fallback. Everything is optional.
 */
export interface ProductData {
  name: string | null
  brand: string | null
  /** EUR only; a price in another currency is left out. */
  price: number | null
  availability: Availability
  image: string | null
  rating: Rating | null
}

export function extractProductData(html: string, pageUrl: string): ProductData | null {
  const fromLd = productFromJsonLd(html, pageUrl)
  const fromMeta = productFromMeta(html, pageUrl)
  if (!fromLd && !fromMeta) return null
  const merged: ProductData = {
    name: fromLd?.name ?? fromMeta?.name ?? null,
    brand: fromLd?.brand ?? null,
    price: fromLd?.price ?? fromMeta?.price ?? null,
    availability:
      fromLd && fromLd.availability !== 'unknown' ? fromLd.availability : (fromMeta?.availability ?? 'unknown'),
    image: fromLd?.image ?? fromMeta?.image ?? null,
    rating: fromLd?.rating ?? null,
  }
  const empty = !merged.price && merged.availability === 'unknown' && !merged.image && !merged.rating
  return empty ? null : merged
}

// ---------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------

/**
 * Reads a EUR amount the way Belgian shops write it: "€ 1.299,00", "129,-",
 * "1 299", "59.99", "from 129". A lone separator followed by exactly three
 * digits is a thousands separator ("1.299" = 1299). A range keeps its low end.
 */
export function parsePriceEur(input: unknown): number | null {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? round2(input) : null
  if (typeof input !== 'string') return null
  const m = /\d[\d.,\u00a0\u202f ]*/.exec(input)
  if (!m) return null
  let s = m[0].replace(/[\u00a0\u202f ]/g, '').replace(/[.,]+$/, '')
  const lastDot = s.lastIndexOf('.')
  const lastComma = s.lastIndexOf(',')
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ','
    const thousands = decimal === '.' ? ',' : '.'
    s = s.split(thousands).join('').replace(decimal, '.')
  } else if (lastDot !== -1 || lastComma !== -1) {
    const sep = lastDot !== -1 ? '.' : ','
    const parts = s.split(sep)
    const tail = parts[parts.length - 1]
    s = parts.length > 2 || tail.length === 3 ? parts.join('') : `${parts[0]}.${tail}`
  }
  const value = Number.parseFloat(s)
  return Number.isFinite(value) && value > 0 ? round2(value) : null
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

// ---------------------------------------------------------------------------
// JSON-LD
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function productFromJsonLd(html: string, pageUrl: string): ProductData | null {
  const products: Json[] = []
  const re = /<script[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const parsed = parseLd(m[1])
    if (parsed !== undefined) collectProducts(parsed, products, 0)
  }
  if (products.length === 0) return null
  // The page's own product is the one with offers; related-product carousels
  // usually come without.
  const product = products.find((p) => p.offers) ?? products[0]
  const offer = bestOffer(product.offers)
  return {
    name: str(product.name),
    brand: typeof product.brand === 'string' ? product.brand : str((product.brand as Json | undefined)?.name),
    price: offer.price,
    availability: offer.availability,
    image: imageUrl(product.image, pageUrl),
    rating: rating(product.aggregateRating),
  }
}

function parseLd(text: string): unknown {
  const cleaned = text.trim().replace(/^<!--/, '').replace(/-->$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    // Shops hand-write these; tolerate raw newlines inside strings.
    try {
      return JSON.parse(cleaned.replace(/[\r\n\t]+/g, ' '))
    } catch {
      return undefined
    }
  }
}

function collectProducts(node: unknown, out: Json[], depth: number): void {
  if (depth > 6 || !node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const n of node) collectProducts(n, out, depth + 1)
    return
  }
  const obj = node as Json
  const types = ([] as unknown[]).concat(obj['@type'] ?? [])
  if (types.some((t) => t === 'Product' || t === 'ProductGroup' || t === 'IndividualProduct')) {
    out.push(obj)
    // A ProductGroup carries offers on its variants.
    if (!obj.offers && Array.isArray(obj.hasVariant)) {
      const withOffers = (obj.hasVariant as Json[]).find((v) => v?.offers)
      if (withOffers) out.push({ ...obj, offers: withOffers.offers })
    }
  }
  for (const key of ['@graph', 'mainEntity', 'itemListElement', 'item']) {
    if (key in obj) collectProducts(obj[key], out, depth + 1)
  }
}

/**
 * The offer to show: the cheapest one in stock, else the cheapest one at all.
 * Offers in another currency are ignored.
 */
function bestOffer(offers: unknown): { price: number | null; availability: Availability } {
  const list = ([] as unknown[])
    .concat(offers ?? [])
    .filter((o): o is Json => !!o && typeof o === 'object')
    .filter((o) => {
      const currency = str(o.priceCurrency) ?? str((o.priceSpecification as Json | undefined)?.priceCurrency)
      return !currency || currency.toUpperCase() === 'EUR'
    })
    .map((o) => ({
      price:
        parsePriceEur(o.price) ??
        parsePriceEur(o.lowPrice) ??
        parsePriceEur((o.priceSpecification as Json | undefined)?.price),
      availability: availabilityOf(o.availability),
    }))
  const cheapest = (xs: typeof list) =>
    xs.filter((x) => x.price !== null).sort((a, b) => (a.price as number) - (b.price as number))[0]
  return (
    cheapest(list.filter((x) => x.availability === 'in_stock')) ??
    cheapest(list) ??
    list.find((x) => x.availability !== 'unknown') ?? { price: null, availability: 'unknown' }
  )
}

export function availabilityOf(value: unknown): Availability {
  const v = String(value ?? '').toLowerCase()
  if (!v) return 'unknown'
  if (/outofstock|soldout|discontinued|out of stock|oos/.test(v)) return 'out_of_stock'
  if (/preorder|presale|backorder|pre-order/.test(v)) return 'preorder'
  if (/instock|limitedavailability|onlineonly|instoreonly|in stock|in_stock/.test(v)) return 'in_stock'
  return 'unknown'
}

function rating(value: unknown): Rating | null {
  if (!value || typeof value !== 'object') return null
  const r = value as Json
  const raw = Number.parseFloat(String(r.ratingValue ?? '').replace(',', '.'))
  if (!Number.isFinite(raw) || raw <= 0) return null
  const best = Number.parseFloat(String(r.bestRating ?? '5').replace(',', '.')) || 5
  const count = Number.parseInt(String(r.reviewCount ?? r.ratingCount ?? ''), 10)
  return {
    value: Math.round(((raw / best) * 5) * 10) / 10,
    count: Number.isFinite(count) ? count : null,
  }
}

function imageUrl(value: unknown, pageUrl: string): string | null {
  const first = ([] as unknown[]).concat(value ?? [])[0]
  const raw = typeof first === 'string' ? first : str((first as Json | undefined)?.url) ?? str((first as Json | undefined)?.contentUrl)
  return absoluteHttpUrl(raw, pageUrl)
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

// ---------------------------------------------------------------------------
// Meta tags (OpenGraph, product:*)
// ---------------------------------------------------------------------------

function productFromMeta(html: string, pageUrl: string): ProductData | null {
  const meta = new Map<string, string>()
  for (const m of html.matchAll(/<meta\s[^>]*>/gi)) {
    const attrs = parseAttributes(m[0])
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop)?.toLowerCase()
    const content = attrs.content
    if (key && content !== undefined && !meta.has(key)) meta.set(key, content)
  }
  const currency = meta.get('product:price:currency') ?? meta.get('og:price:currency') ?? meta.get('pricecurrency')
  const eur = !currency || currency.toUpperCase() === 'EUR'
  const price = eur
    ? parsePriceEur(meta.get('product:price:amount') ?? meta.get('og:price:amount') ?? meta.get('price'))
    : null
  const availability = availabilityOf(
    meta.get('product:availability') ?? meta.get('og:availability') ?? meta.get('availability'),
  )
  const image = absoluteHttpUrl(meta.get('og:image') ?? meta.get('og:image:url') ?? null, pageUrl)
  if (price === null && availability === 'unknown' && !image) return null
  return { name: meta.get('og:title') ?? null, brand: null, price, availability, image, rating: null }
}

function parseAttributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  for (const m of tag.matchAll(/([a-zA-Z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}

export function absoluteHttpUrl(raw: string | null, base: string): string | null {
  if (!raw) return null
  try {
    const u = new URL(raw, base)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&euro;/gi, '€')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => safeCodePoint(parseInt(code, 10)))
    .replace(/&amp;/gi, '&')
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : ''
}
