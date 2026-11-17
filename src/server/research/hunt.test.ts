import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HuntTarget } from '../../types'
import { ResearchError } from './errors'
import { HUNT_NOTHING } from './hunt'
import type { Page } from './http'
import { ModelRouter, type GenerateArgs, type LlmProvider } from './llm'
import { PipelineEngine } from './pipeline'
import type { ProductData } from './product'
import type { SearchProvider, SearchResult } from './search'

vi.mock('./http', () => ({ fetchPage: vi.fn() }))
const http = await import('./http')

const TARGET: HuntTarget = { product: 'Feliway Friends', variant: '48 ml', condition: 'new', exclude: [], unit: 'vial' }
const SHOPS = ['a', 'b', 'c', 'd'].map((s) => `https://shop-${s}.be/feliway-friends`)
const LISTING = 'https://shop-a.be/search?q=feliway'
const HITS: SearchResult[] = [
  ...SHOPS.map((url, i) => ({ title: `Feliway ${i}`, url, snippet: '' })),
  { title: 'listing', url: LISTING, snippet: '' },
]

function product(over: Partial<ProductData>): ProductData {
  return { name: null, brand: null, price: null, availability: 'unknown', image: null, rating: null, ...over }
}
const page = (price: number): Page => ({
  status: 'live',
  title: 'p',
  text: 'Feliway',
  product: product({ price, availability: 'in_stock' }),
})
const WALL: Page = { status: 'unknown', title: '', text: '', product: null }

function pages(byUrl: Record<string, Page>) {
  vi.mocked(http.fetchPage).mockImplementation(async (url) => byUrl[url] ?? WALL)
}

const free = { kind: 'free' }
const FACTS = (url: string, packs: number) => ({ url, title: 'Feliway Friends 48 ml', match: 'exact', packs, delivery: free })

class HuntModel implements LlmProvider {
  readonly id = 'fake'
  calls = 0
  constructor(
    private readonly plan: unknown = { title: 'Feliway Friends', target: TARGET, refill: true, searchQueries: ['q'] },
    private readonly snippetPrice: number | null = null,
  ) {}
  async generate(args: GenerateArgs): Promise<unknown> {
    this.calls += 1
    const s = args.systemInstruction
    if (s.includes('planning step')) return this.plan
    if (s.includes('offer-selection')) {
      return { offers: SHOPS.slice(0, 3).map((url) => ({ url, shop: new URL(url).host, title: 'Feliway', price: this.snippetPrice })) }
    }
    return { offers: SHOPS.slice(0, 3).map((url, i) => FACTS(url, i === 2 ? 2 : 1)) }
  }
}

const search = (queries: string[] = []): SearchProvider => ({
  async search(q) {
    queries.push(q)
    return HITS
  },
})

const engine = (model: LlmProvider, s = search()) =>
  new PipelineEngine({ router: new ModelRouter({ chain: [model], sleep: async () => {}, backoffBaseMs: 1 }), search: s, sleep: async () => {} })

beforeEach(() => {
  vi.mocked(http.fetchPage).mockReset()
  pages({ [SHOPS[0]]: page(30), [SHOPS[1]]: page(28), [SHOPS[2]]: page(50) })
})

describe('hunt', () => {
  it('hunts an exact product, ranks by delivered price and never fetches a listing page', async () => {
    const steps: string[] = []
    const model = new HuntModel()
    const res = await engine(model).research({ ideaId: 1, text: 'feliway', mode: 'hunt', target: TARGET, onProgress: (s) => steps.push(s) })
    expect(res.brief).toMatchObject({ mode: 'hunt', target: TARGET, refill: true })
    expect(res.picks).toHaveLength(3)
    expect(res.picks.every((p) => p.kind === 'offer')).toBe(true)
    // Shop c sells 2 packs for 50: 25 per vial beats 28 and 30.
    expect(res.picks[0]).toMatchObject({ rank: 1, url: SHOPS[2] })
    expect(res.picks[0].offer?.group).toBe('best')
    expect(vi.mocked(http.fetchPage).mock.calls.map((c) => c[0])).not.toContain(LISTING)
    expect(steps).toEqual([
      'working out what to look for',
      'looking for every shop that sells it',
      'picking the offer pages',
      'reading 3 shop pages',
      'checking match, packs and delivery',
      'ranking by delivered price',
    ])
    expect(model.calls).toBe(3)
  })

  it('stays within 4 queries and 10 pages', async () => {
    const queries: string[] = []
    await engine(new HuntModel({ title: 't', target: TARGET, searchQueries: ['1', '2', '3', '4', '5', '6'] }), search(queries)).research({
      ideaId: 1,
      text: 'x',
      mode: 'hunt',
    })
    expect(queries.length).toBeLessThanOrEqual(4)
    expect(vi.mocked(http.fetchPage).mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('never checks or crowns a price the page did not state', async () => {
    const stockOnly: Page = { status: 'live', title: 'p', text: 'Feliway', product: product({ price: null, availability: 'in_stock' }) }
    pages({ [SHOPS[0]]: stockOnly, [SHOPS[1]]: stockOnly, [SHOPS[2]]: stockOnly })
    const err = await engine(new HuntModel(undefined, 9)).research({ ideaId: 1, text: 'x', mode: 'hunt', target: TARGET }).catch((e) => e)
    expect(err).toMatchObject({ kind: 'no-results', message: HUNT_NOTHING })
  })

  it('fails with no-results when no offer is checked and in stock', async () => {
    pages({})
    const err = await engine(new HuntModel()).research({ ideaId: 1, text: 'x', mode: 'hunt', target: TARGET }).catch((e) => e)
    expect(err).toBeInstanceOf(ResearchError)
    expect(err).toMatchObject({ kind: 'no-results', message: HUNT_NOTHING })
  })

  it('round 1 may guess a hunt with no extra model call', async () => {
    const model = new HuntModel({ title: 'F', mode: 'hunt', target: TARGET, refill: false, searchQueries: ['q'], summary: '', criteria: [] })
    const res = await engine(model).research({ ideaId: 1, text: 'feliway friends 48 ml' })
    expect(res.brief).toMatchObject({ mode: 'hunt', target: TARGET, refill: false })
    expect(model.calls).toBe(3)
  })

  it('keeps the owner target over the model plan', async () => {
    const other = { ...TARGET, variant: 'other' }
    const model = new HuntModel({ title: 't', target: other, searchQueries: ['q'] })
    const res = await engine(model).research({ ideaId: 1, text: 'x', mode: 'hunt', target: TARGET, targetByOwner: true })
    expect(res.brief.target).toEqual(TARGET)
  })
})

describe('hunt: referral sites', () => {
  const BOL = 'https://www.bol.com/be/nl/p/feliway-friends/9300000161151384/'

  /** Flags shop a as a referral page; reads whatever pages it is given. */
  class ReferralModel extends HuntModel {
    seen: string[] = []
    override async generate(args: GenerateArgs): Promise<unknown> {
      if (!args.systemInstruction.includes('offer-reading')) return super.generate(args)
      this.calls += 1
      const urls = [...args.contents.matchAll(/--- PAGE: (\S+)/g)].map((m) => m[1] as string)
      this.seen = urls
      return { offers: urls.map((url) => ({ ...FACTS(url, 1), referral: url === SHOPS[0] })) }
    }
  }

  it('reads the shop a referral page links to and offers that shop instead', async () => {
    const referral: Page = { ...page(20), referrals: [BOL] }
    pages({ [SHOPS[0]]: referral, [SHOPS[1]]: page(28), [SHOPS[2]]: page(50), [BOL]: page(25) })
    const model = new ReferralModel()
    const res = await engine(model).research({ ideaId: 1, text: 'feliway', mode: 'hunt', target: TARGET })
    expect(model.seen).toContain(BOL)
    const urls = res.picks.map((p) => p.url)
    expect(urls).not.toContain(SHOPS[0])
    expect(res.picks[0]).toMatchObject({ url: BOL, shop: 'bol.com', price: 25 })
    expect(res.picks[0]?.offer?.group).toBe('best')
  })

  it('does not read a linked page twice when search found it too', async () => {
    pages({ [SHOPS[0]]: { ...page(30), referrals: [SHOPS[1]] }, [SHOPS[1]]: page(28), [SHOPS[2]]: page(50) })
    await engine(new ReferralModel()).research({ ideaId: 1, text: 'feliway', mode: 'hunt', target: TARGET })
    expect(vi.mocked(http.fetchPage).mock.calls.filter((c) => c[0] === SHOPS[1])).toHaveLength(1)
  })
})
