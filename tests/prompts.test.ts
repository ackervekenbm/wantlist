import { describe, expect, it } from 'vitest'
import {
  extractText,
  extractTitle,
} from '../src/server/research/http'
import { parseJsonLoose } from '../src/server/research/json'
import { isHttpUrl, mergePicksByProduct, normalizeProductTitle, normalizeUrl } from '../src/server/research/offers'
import { ResearchError } from '../src/server/research/errors'
import {
  buildCandidateUser,
  buildLearnUser,
  capPreferences,
  keepOwnerItems,
  normalizeLearn,
  normalizePass1,
  normalizePass2,
  normalizePlan,
} from '../src/server/research/prompts'
import type { FinalPick, HistoryPick, Preferences, ResearchCandidate, ResearchHistory } from '../src/types'

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
        { title: 'In', shop: 'A', url: 'https://a.be/fan?utm_source=x' },
        { title: 'In2', shop: 'B', url: 'https://b.eu/fan' },
        { title: 'Other product', shop: 'B', url: 'https://b.eu/fan?id=2' },
        { title: 'Invented', shop: 'Z', url: 'https://phishing.example/x' },
      ],
    }
    const result = normalizePass1(raw, allowed)
    expect(result.candidates.map((c) => c.url)).toEqual([
      'https://a.be/fan?utm_source=x',
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
    const result = normalizePass2(raw, allowed, 0).picks
    expect(result).toHaveLength(1)
    expect(result[0].shop).toBe('Sportimo')
    expect(result[0].url).toBe('https://a.be/fan')
    expect(result[0].price).toBe(269)
    expect(result[0].suppliers.map((s) => s.shop)).toEqual(['Sportimo', 'Bicyclic'])
    expect(result[0].suppliers[0]).toEqual({
      shop: 'Sportimo',
      url: 'https://a.be/fan',
      price: 269,
      availability: 'unknown',
      checked: false,
    })
  })

  it('keeps the caveat and drops an empty one', () => {
    const raw = {
      picks: [
        { title: 'A', why: 'w', caveat: ' Loud at full speed ', suppliers: [{ shop: 'S', url: 'https://a.be/fan', price: '' }] },
        { title: 'B', why: 'w', caveat: '', suppliers: [{ shop: 'S', url: 'https://b.eu/fan', price: '' }] },
      ],
    }
    const [a, b] = normalizePass2(raw, allowed, 0).picks
    expect(a.caveat).toBe('Loud at full speed')
    expect(b.caveat).toBeNull()
  })

  it('dedupes identical products into a single pick', () => {
    const raw = {
      picks: [
        { title: 'Wahoo KICKR Headwind Smart Fan', why: 'a', suppliers: [{ shop: 'A', url: 'https://a.be/fan', price: '269' }] },
        { title: 'Wahoo KICKR Headwind Smart Fan', why: 'b', suppliers: [{ shop: 'B', url: 'https://b.eu/fan', price: '279.99' }] },
      ],
    }
    const result = normalizePass2(raw, allowed, 0).picks
    expect(result).toHaveLength(1)
    expect(result[0].suppliers).toHaveLength(2)
  })

  it('falls back to a flat supplier offer when the array shape is absent', () => {
    const raw = {
      picks: [{ url: 'https://b.eu/fan', why: 'solo' }],
    }
    const result = normalizePass2(raw, allowed, 0).picks
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
    expect(normalizePass2(raw, allowed, 0).picks).toHaveLength(0)
  })
})

describe('refine-round prompts', () => {
  const prefs: Preferences = { summary: 'a cosy throw', mustHaves: ['washable'], avoid: ['no fleece'], likes: [] }
  const hp = (i: number, extra: Partial<HistoryPick> = {}): HistoryPick => ({
    round: 1,
    title: `Throw ${i}`,
    shop: 'Shop',
    price: 40,
    why: null,
    reaction: null,
    reason: null,
    urls: [`https://s.be/${i}`],
    ...extra,
  })
  const pass2Pick = (url: string, repeatOf: number) => ({
    title: `P ${url}`,
    why: 'w',
    repeatOf,
    suppliers: [{ shop: 'S', url, price: '' }],
  })
  const allowed: ResearchCandidate[] = [
    { title: 'Fan A', shop: 'Shop', url: 'https://a.be/fan', price: null, why: null },
    { title: 'Fan B', shop: 'Shop2', url: 'https://b.eu/fan', price: null, why: null },
  ]

  it('normalizePlan caps the title', () => {
    const plan = normalizePlan({ title: ` ${'t'.repeat(61)} `, searchQueries: ['q'] })
    expect(plan.title).toBe('t'.repeat(60))
  })

  it('capPreferences coerces, trims, drops empties and caps', () => {
    expect(capPreferences({ summary: 5, mustHaves: [' a ', '', 'x'.repeat(200)], avoid: 'nope' })).toEqual({
      summary: '5',
      mustHaves: ['a', 'x'.repeat(120)],
      avoid: [],
      likes: [],
    })
    const many = Array.from({ length: 20 }, (_, i) => `item ${i}`)
    expect(capPreferences({ likes: many }).likes).toHaveLength(12)
    expect(capPreferences(null)).toEqual({ summary: '', mustHaves: [], avoid: [], likes: [] })
  })

  it('keepOwnerItems keeps an owner item the model dropped', () => {
    const learned = { summary: 's', mustHaves: [], avoid: ['no wool'], likes: [] }
    expect(keepOwnerItems(learned, prefs).avoid).toEqual(['no fleece', 'no wool'])
    expect(keepOwnerItems(learned, prefs).mustHaves).toEqual(['washable'])
  })

  it('buildLearnUser lists reactions, the owner heading and at most 40 picks', () => {
    const history: ResearchHistory = {
      mode: 'learn',
      preferences: prefs,
      preferencesEdited: true,
      picks: [
        hp(0, { reaction: 'no', reason: 'too fluffy' }),
        ...Array.from({ length: 49 }, (_, i) => hp(i + 1)),
      ],
    }
    const user = buildLearnUser({ text: 'a throw', budget: null, notes: null }, 'Cosy throw', history)
    expect(user).toContain('reaction: no — "too fluffy"')
    expect(user).toContain('set by the owner — keep every item')
    expect(user.split('\n').filter((l) => l.startsWith('round ')).length).toBe(40)
  })

  it('normalizeLearn throws an invalid ResearchError without queries', () => {
    try {
      normalizeLearn({ title: 't', preferences: prefs, searchQueries: [] })
      expect.fail('should throw')
    } catch (err) {
      expect(err).toBeInstanceOf(ResearchError)
      expect((err as ResearchError).kind).toBe('invalid')
    }
  })

  it('buildCandidateUser adds the already-shown block only when something was shown', () => {
    const idea = { text: 'a throw', budget: null, notes: null }
    const results = [{ title: 'r', url: 'https://r.be', snippet: 's' }]
    const shown = buildCandidateUser(idea, prefs, results, [hp(1, { title: 'Old Throw' })])
    expect(shown).toContain('Already shown')
    expect(shown).toContain('Old Throw')
    expect(buildCandidateUser(idea, prefs, results, [])).not.toContain('Already shown')
  })

  it('normalizePass2 drops and counts repeats of shown products', () => {
    const raw = { picks: [pass2Pick('https://a.be/fan', 2), pass2Pick('https://b.eu/fan', 0)] }
    const result = normalizePass2(raw, allowed, 3)
    expect(result.picks).toHaveLength(1)
    expect(result.repeats).toBe(1)
  })

  it('ignores repeatOf in round 1 or out of range', () => {
    expect(normalizePass2({ picks: [pass2Pick('https://a.be/fan', 1)] }, allowed, 0).picks).toHaveLength(1)
    expect(normalizePass2({ picks: [pass2Pick('https://a.be/fan', 5)] }, allowed, 2).picks).toHaveLength(1)
  })

  it('normalizePass1 filters excluded candidates before the cut', () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({ title: `p${i}`, shop: 's', url: `https://e.com/p${i}` }))
    const excluded = new Set(['p0', 'p1', 'p2'])
    const result = normalizePass1({ candidates }, undefined, (c) => excluded.has(c.title))
    expect(result.candidates.map((c) => c.title)).toEqual(['p3', 'p4', 'p5', 'p6'])
  })
})

describe('mergePicksByProduct', () => {
  const pick = (title: string, shop: string, url: string, price: number): FinalPick => ({
    rank: 0,
    title,
    shop,
    url,
    price,
    why: '',
    caveat: null,
    image: null,
    rating: null,
    sourceUrls: [],
    suppliers: [{ shop, url, price, availability: 'unknown', checked: false }],
  })

  it('merges same-title products and prefers the best price', () => {
    const merged = mergePicksByProduct([
      pick('Wahoo KICKR Headwind', 'Bicyclic', 'https://b.eu/fan', 279.99),
      pick('wahoo  kickr headwind', 'Sportimo', 'https://a.be/fan', 269),
    ])
    expect(merged).toHaveLength(1)
    expect(merged[0].shop).toBe('Sportimo')
    expect(merged[0].suppliers).toHaveLength(2)
  })

  it('keeps distinct titles separate', () => {
    const merged = mergePicksByProduct([
      pick('Fan A', 'A', 'https://a.be/a', 10),
      pick('Fan B Pro', 'B', 'https://b.eu/b', 20),
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

  it('drops the hash, trailing slash and tracking parameters for de-dup matching', () => {
    expect(normalizeUrl('https://a.be/fan#top')).toBe('https://a.be/fan')
    expect(normalizeUrl('https://a.be/fan/')).toBe('https://a.be/fan')
    expect(normalizeUrl('https://A.be/fan?utm_source=x&srsltid=abc&gclid=1')).toBe('https://a.be/fan')
  })

  it('keeps parameters that identify the product, in a stable order', () => {
    expect(normalizeUrl('https://a.be/p.php?id=1&utm_medium=cpc')).toBe('https://a.be/p.php?id=1')
    expect(normalizeUrl('https://a.be/p.php?id=1')).not.toBe(normalizeUrl('https://a.be/p.php?id=2'))
    expect(normalizeUrl('https://a.be/p?b=2&a=1')).toBe(normalizeUrl('https://a.be/p?a=1&b=2'))
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