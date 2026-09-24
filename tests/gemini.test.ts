import { describe, expect, it } from 'vitest'
import {
  extractText,
  extractTitle,
} from '../src/server/research/http'
import {
  isHttpUrl,
  normalizePass1,
  normalizePass2,
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

describe('normalizePass1', () => {
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
    { title: 'Fan A', shop: 'Shop', url: 'https://a.be/fan?x=1', price: '100', why: 'quiet' },
    { title: 'Fan B', shop: 'Shop2', url: 'https://b.eu/fan', price: null, why: null },
  ]

  it('keeps only picks whose url matches an allowed candidate', () => {
    const raw = {
      picks: [
        { rank: 1, title: 'Fan A', shop: 'Shop', url: 'https://a.be/fan?x=1', price: '95', why: 'even cheaper' },
        { rank: 2, title: 'Made up', shop: 'Nope', url: 'https://madeup.example/x', why: 'nope' },
        { rank: 2, title: 'Fan B', shop: 'Shop2', url: 'https://b.eu/fan', price: null, why: 'ok' },
      ],
    }
    const result = normalizePass2(raw, allowed)
    expect(result).toHaveLength(2)
    expect(result[0].title).toBe('Fan A')
    expect(result[0].price).toBe('95')
    expect(result.map((p) => p.rank)).toEqual([1, 2])
  })

  it('falls back to candidate details when the pick omits them', () => {
    const raw = {
      picks: [{ url: 'https://b.eu/fan', why: 'solo' }],
    }
    const result = normalizePass2(raw, allowed)
    expect(result[0].title).toBe('Fan B')
    expect(result[0].shop).toBe('Shop2')
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