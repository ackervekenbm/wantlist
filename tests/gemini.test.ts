import { describe, expect, it } from 'vitest'
import {
  extractText,
  extractTitle,
} from '../src/server/research/http'
import {
  isHttpUrl,
  mergePicksByProduct,
  normalizePass1,
  normalizePass2,
  normalizePlan,
  normalizeProductTitle,
  normalizeUrl,
  parseJsonLoose,
} from '../src/server/research/gemini'
import type { ResearchCandidate } from '../src/types'

describe('parseJsonLoose', () => {
  it('parses plain json', () => {
    expect(parseJsonLoose('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses json inside code fences', () => {
    expect(parseJsonLoose('Here you go:\n```json\n{"a":2}\n```\n')).toEqual({ a: 2 })
  })

  it('extracts the first object when surrounded by prose', () => {
    expect(parseJsonLoose('Sure! {"b":3} hope that helps')).toEqual({ b: 3 })
  })
})

describe('normalizePlan', () => {
  it('keeps up to 4 queries and drops the rest', () => {
    const result = normalizePlan({
      summary: 'fans',
      criteria: ['quiet', 'eur'],
      searchQueries: [1, 'two', '', '  ', 'five', 'six'],
    })
    expect(result.searchQueries).toEqual(['1', 'two', 'five', 'six'])
    expect(result.criteria).toEqual(['quiet', 'eur'])
  })

  it('throws when there are no queries', () => {
    expect(() => normalizePlan({ searchQueries: [] })).toThrow(/no search queries/)
  })
})

describe('normalizePass1', () => {
  it('drops candidates not in the allowed url set', () => {
    const allowed = new Set(['https://a.be/fan', 'https://b.eu/fan/'])
    const raw = {
      candidates: [
        { title: 'In', shop: 'A', url: 'https://a.be/fan?utm=1' },
        { title: 'In2', shop: 'B', url: 'https://b.eu/fan' },
        { title: 'Invented', shop: 'Z', url: 'https://phishing.example/x' },
      ],
    }
    const result = normalizePass1(raw, allowed)
    expect(result.candidates.map((c) => c.url)).toEqual([
      'https://a.be/fan?utm=1',
      'https://b.eu/fan',
    ])
  })

  it('drops candidates with missing or invalid urls', () => {
    const raw = {
      summary: 'something',
      criteria: ['a', 'b'],
      candidates: [
        { title: 'Good', shop: 'X', url: 'https://x.be/product', price: '19', why: 'nice' },
        { title: 'No url', shop: 'Y', url: 'not-a-url' },
        { title: 'Relative', shop: 'Z', url: '/product/2' },
        { title: 'Empty', shop: 'Q', url: '' },
      ],
      followUpQueries: ['q1'],
    }
    const result = normalizePass1(raw)
    expect(result.candidates).toHaveLength(1)
    expect(result.candidates[0].title).toBe('Good')
    expect(result.candidates[0].price).toBe('19')
  })

  it('caps at five candidates', () => {
    const candidates = Array.from({ length: 9 }).map((_, i) => ({
      title: `p${i}`,
      shop: 's',
      url: `https://example.com/p${i}`,
    }))
    const result = normalizePass1({ candidates })
    expect(result.candidates).toHaveLength(5)
  })
})

describe('normalizePass2', () => {
  const allowed: ResearchCandidate[] = [
    { title: 'Fan A', shop: 'Shop', url: 'https://a.be/fan', price: '100', why: 'quiet' },
    { title: 'Fan B', shop: 'Shop2', url: 'https://b.eu/fan', price: null, why: null },
  ]

  it('groups suppliers by product and exposes the best offer as primary', () => {
    const raw = {
      picks: [
        {
          rank: 1,
          title: 'Wahoo KICKR Headwind',
          why: 'syncs with trainer',
          suppliers: [
            { shop: 'Bicyclic', url: 'https://b.eu/fan', price: '279.99' },
            { shop: 'Sportimo', url: 'https://a.be/fan', price: '269' },
            { shop: 'Made up', url: 'https://madeup.example/x', price: '1' },
          ],
        },
      ],
    }
    const result = normalizePass2(raw, allowed)
    expect(result).toHaveLength(1)
    expect(result[0].shop).toBe('Sportimo')
    expect(result[0].url).toBe('https://a.be/fan')
    expect(result[0].price).toBe('269')
    expect(result[0].suppliers.map((s) => s.shop)).toEqual(['Sportimo', 'Bicyclic'])
  })

  it('dedupes identical products into a single pick', () => {
    const raw = {
      picks: [
        { title: 'Wahoo KICKR Headwind Smart Fan', why: 'a', suppliers: [{ shop: 'A', url: 'https://a.be/fan', price: '269' }] },
        { title: 'Wahoo KICKR Headwind Smart Fan', why: 'b', suppliers: [{ shop: 'B', url: 'https://b.eu/fan', price: '279.99' }] },
      ],
    }
    const result = normalizePass2(raw, allowed)
    expect(result).toHaveLength(1)
    expect(result[0].suppliers).toHaveLength(2)
  })

  it('falls back to a flat supplier offer when the array shape is absent', () => {
    const raw = {
      picks: [{ url: 'https://b.eu/fan', why: 'solo' }],
    }
    const result = normalizePass2(raw, allowed)
    expect(result[0].title).toBe('Fan B')
    expect(result[0].shop).toBe('Shop2')
    expect(result[0].suppliers).toHaveLength(1)
  })

  it('drops picks with no valid supplier url', () => {
    const raw = {
      picks: [
        { title: 'Ghost', suppliers: [{ shop: 'X', url: 'https://not-allowed.example/p', price: null }] },
      ],
    }
    expect(normalizePass2(raw, allowed)).toHaveLength(0)
  })
})

describe('mergePicksByProduct', () => {
  const pick = (title: string, shop: string, url: string, price: string) => ({
    rank: 0,
    title,
    shop,
    url,
    price,
    why: '',
    suppliers: [{ shop, url, price }],
  })

  it('merges same-title products and prefers the best price', () => {
    const merged = mergePicksByProduct([
      pick('Wahoo KICKR Headwind', 'Bicyclic', 'https://b.eu/fan', '279.99'),
      pick('wahoo  kickr headwind', 'Sportimo', 'https://a.be/fan', '269'),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].shop).toBe('Sportimo')
    expect(merged[0].suppliers).toHaveLength(2)
  })

  it('keeps distinct titles separate', () => {
    const merged = mergePicksByProduct([
      pick('Fan A', 'A', 'https://a.be/a', '10'),
      pick('Fan B Pro', 'B', 'https://b.eu/b', '20'),
    ])
    expect(merged).toHaveLength(2)
  })

  it('normalizes trailing punctuation out of titles', () => {
    expect(normalizeProductTitle('Wahoo KICKR Headwind!')).toBe('wahoo kickr headwind')
  })
})

describe('url helpers', () => {
  it('recognises http(s) urls only', () => {
    expect(isHttpUrl('https://x.be/a')).toBe(true)
    expect(isHttpUrl('http://x.be/a')).toBe(true)
    expect(isHttpUrl('ftp://x.be/a')).toBe(false)
    expect(isHttpUrl('x.be/a')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })

  it('strips hash and query for de-dup matching', () => {
    expect(normalizeUrl('https://a.be/fan?x=1#top')).toBe('https://a.be/fan')
    expect(normalizeUrl('https://a.be/fan/')).toBe('https://a.be/fan')
  })
})

describe('html extraction', () => {
  it('extracts title and flattens text', () => {
    const html =
      '<html><head><title>Cool Fan — Shop</title></head><body>' +
      '<script>doNotRead()</script><style>.x{}</style>' +
      '<h1>Cool Fan</h1><p>It is &quot;quiet&quot; &amp; strong.</p></body></html>'
    expect(extractTitle(html)).toBe('Cool Fan — Shop')
    expect(extractText(html)).toContain('Cool Fan It is "quiet" & strong.')
    expect(extractText(html)).not.toContain('doNotRead')
  })
})