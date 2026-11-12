import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Page } from '../src/server/research/http'
import type { ProductData } from '../src/server/research/product'
import { NOTHING_NEW, ResearchError } from '../src/server/research/errors'
import { ModelRouter, type GenerateArgs, type LlmProvider } from '../src/server/research/llm'
import { PipelineEngine } from '../src/server/research/pipeline'
import { SerperProvider, type SearchProvider, type SearchResult } from '../src/server/research/search'
import type { HistoryPick, ResearchHistory } from '../src/types'

vi.mock('../src/server/research/http', () => ({ fetchPage: vi.fn() }))

const http = await import('../src/server/research/http')

const HITS: SearchResult[] = [
  { title: 'Wahoo KICKR Headwind', url: 'https://bikeshop.be/headwind', snippet: '€229' },
  { title: 'Lasko fan', url: 'https://www.bol.com/be/nl/p/lasko/123', snippet: '€59' },
]

const LIVE: Page = { status: 'live', title: 'page', text: 'In stock. Quiet 40 dB fan.', product: null }

function product(over: Partial<ProductData>): ProductData {
  return { name: null, brand: null, price: null, availability: 'unknown', image: null, rating: null, ...over }
}

/** Pages by URL; anything not listed is a plain live page without product data. */
function pages(byUrl: Record<string, Partial<Page>>) {
  vi.mocked(http.fetchPage).mockImplementation(async (url) => ({ ...LIVE, ...byUrl[url] }))
}

/** Answers each pipeline step by recognizing its system prompt. */
class StepModel implements LlmProvider {
  readonly id = 'fake'
  verifyPrompt = ''
  learnPrompt = ''
  prompts: string[] = []
  systems: string[] = []
  constructor(
    private readonly answers: { plan?: unknown; learn?: unknown; candidates?: unknown; verify?: unknown },
  ) {}
  async generate(args: GenerateArgs): Promise<unknown> {
    this.prompts.push(args.contents)
    this.systems.push(args.systemInstruction)
    if (args.systemInstruction.includes('learn step')) {
      this.learnPrompt = args.contents
      return (
        this.answers.learn ?? {
          title: 'Quiet cycling fan',
          preferences: { summary: 'a quiet fan', mustHaves: ['quiet'], avoid: ['loud fans'], likes: [] },
          searchQueries: ['quiet indoor cycling fan'],
        }
      )
    }
    if (args.systemInstruction.includes('planning step')) {
      return this.answers.plan ?? { summary: 'a fan', criteria: ['quiet'], searchQueries: ['indoor cycling fan'] }
    }
    if (args.systemInstruction.includes('candidate-selection')) {
      return (
        this.answers.candidates ?? {
          candidates: [
            { title: 'Wahoo KICKR Headwind', shop: 'Bikeshop', url: 'https://bikeshop.be/headwind', price: '229', why: 'made for this' },
            { title: 'Lasko fan', shop: 'bol', url: 'https://www.bol.com/be/nl/p/lasko/123', price: '59', why: 'cheap' },
          ],
        }
      )
    }
    this.verifyPrompt = args.contents
    return (
      this.answers.verify ?? {
        picks: [
          {
            title: 'Wahoo KICKR Headwind',
            why: 'Speed follows your heart rate',
            caveat: 'Pricey for a fan',
            suppliers: [{ shop: 'Bikeshop', url: 'https://bikeshop.be/headwind', price: '229' }],
          },
          {
            title: 'Lasko fan',
            why: 'Cheap and strong',
            suppliers: [{ shop: 'bol', url: 'https://www.bol.com/be/nl/p/lasko/123', price: '59' }],
          },
        ],
      }
    )
  }
}

function search(fn: (q: string) => SearchResult[] | Error): SearchProvider & { queries: string[] } {
  const queries: string[] = []
  return {
    queries,
    async search(q) {
      queries.push(q)
      const out = fn(q)
      if (out instanceof Error) throw out
      return out
    },
  }
}

function engine(model: LlmProvider, provider: SearchProvider, extra: LlmProvider[] = []) {
  return new PipelineEngine({
    router: new ModelRouter({ chain: [model, ...extra], sleep: async () => {}, backoffBaseMs: 1 }),
    search: provider,
    sleep: async () => {},
  })
}

beforeEach(() => {
  vi.mocked(http.fetchPage).mockReset()
  pages({})
})

describe('PipelineEngine', () => {
  it('plans, searches, shortlists, reads pages, verifies, checks offers and reports its steps', async () => {
    const steps: string[] = []
    const result = await engine(new StepModel({}), search(() => HITS)).research({
      ideaId: 1,
      text: 'a fan for my bike trainer',
      onProgress: (s) => steps.push(s),
    })
    expect(result.brief).toEqual({
      title: '',
      preferences: { summary: 'a fan', mustHaves: ['quiet'], avoid: [], likes: [] },
    })
    expect(result.picks.map((p) => [p.rank, p.title, p.price, p.caveat])).toEqual([
      [1, 'Wahoo KICKR Headwind', 229, 'Pricey for a fan'],
      [2, 'Lasko fan', 59, null],
    ])
    expect(result.picks[0].sourceUrls).toEqual(['https://bikeshop.be/headwind', 'https://www.bol.com/be/nl/p/lasko/123'])
    expect(steps).toEqual([
      'working out what to look for',
      'searching shops and reviews',
      'shortlisting from 2 results',
      'reading 2 product pages',
      'checking the evidence',
      'checking 2 offers at the shops',
    ])
  })

  it('gives every step the budget and notes', async () => {
    const model = new StepModel({})
    await engine(model, search(() => HITS)).research({ ideaId: 1, text: 'fan', budget: 150, notes: 'white, quiet' })
    expect(model.prompts).toHaveLength(3)
    for (const prompt of model.prompts) {
      expect(prompt).toContain('Idea: "fan"')
      expect(prompt).toContain('Budget: at most EUR 150')
      expect(prompt).toContain('User notes (must-haves, constraints): white, quiet')
    }
  })

  it('leaves budget and notes out when there are none', async () => {
    const model = new StepModel({})
    await engine(model, search(() => HITS)).research({ ideaId: 1, text: 'fan', budget: null, notes: null })
    expect(model.prompts.join('\n')).not.toMatch(/Budget:|User notes/)
  })

  it('fetches each page once, reusing verification reads for the offer check', async () => {
    await engine(new StepModel({}), search(() => HITS)).research({ ideaId: 1, text: 'fan' })
    expect(vi.mocked(http.fetchPage).mock.calls.map((c) => c[0]).sort()).toEqual([
      'https://bikeshop.be/headwind',
      'https://www.bol.com/be/nl/p/lasko/123',
    ])
  })

  it('takes price, stock, photo and rating from the shop page and shows them to the verifier', async () => {
    pages({
      'https://bikeshop.be/headwind': {
        product: product({
          name: 'KICKR Headwind',
          price: 249.99,
          availability: 'in_stock',
          image: 'https://bikeshop.be/hw.jpg',
          rating: { value: 4.6, count: 88 },
        }),
      },
    })
    const model = new StepModel({})
    const { picks } = await engine(model, search(() => HITS)).research({ ideaId: 1, text: 'fan' })
    expect(model.verifyPrompt).toContain('Shop data: KICKR Headwind, price EUR 249.99, in stock, rated 4.6/5 (88 reviews)')
    expect(picks[0]).toMatchObject({ price: 249.99, image: 'https://bikeshop.be/hw.jpg', rating: { value: 4.6, count: 88 } })
    expect(picks[0].suppliers[0]).toMatchObject({ price: 249.99, availability: 'in_stock', checked: true })
    expect(picks[1].suppliers[0]).toMatchObject({ price: 59, availability: 'unknown', checked: false })
  })

  it('sinks products that are sold out everywhere and orders offers in stock first', async () => {
    const verify = {
      picks: [
        {
          title: 'Wahoo KICKR Headwind',
          why: 'w',
          suppliers: [
            { shop: 'Bikeshop', url: 'https://bikeshop.be/headwind', price: '199' },
            { shop: 'bol', url: 'https://www.bol.com/be/nl/p/lasko/123', price: '229' },
          ],
        },
        { title: 'Lasko fan', why: 'w', suppliers: [{ shop: 'X', url: 'https://x.be/lasko', price: '59' }] },
      ],
    }
    const hits = [...HITS, { title: 'Lasko', url: 'https://x.be/lasko', snippet: '' }]
    const candidates = {
      candidates: [
        { title: 'Wahoo KICKR Headwind', shop: 'Bikeshop', url: 'https://bikeshop.be/headwind' },
        { title: 'Wahoo KICKR Headwind', shop: 'bol', url: 'https://www.bol.com/be/nl/p/lasko/123' },
        { title: 'Lasko fan', shop: 'X', url: 'https://x.be/lasko' },
      ],
    }
    pages({
      'https://bikeshop.be/headwind': { product: product({ price: 199, availability: 'out_of_stock' }) },
      'https://www.bol.com/be/nl/p/lasko/123': { product: product({ price: 229, availability: 'in_stock' }) },
    })
    pages({
      'https://bikeshop.be/headwind': { product: product({ price: 199, availability: 'out_of_stock' }) },
      'https://www.bol.com/be/nl/p/lasko/123': { product: product({ price: 229, availability: 'in_stock' }) },
      'https://x.be/lasko': { product: product({ price: 59, availability: 'out_of_stock' }) },
    })
    const { picks } = await engine(new StepModel({ verify, candidates }), search(() => hits)).research({
      ideaId: 1,
      text: 'fan',
    })
    expect(picks.map((p) => p.title)).toEqual(['Wahoo KICKR Headwind', 'Lasko fan'])
    expect(picks[0].suppliers.map((s) => s.shop)).toEqual(['bol', 'Bikeshop'])
    expect(picks[0]).toMatchObject({ shop: 'bol', price: 229 })
  })

  it('drops dead offers and products left without one', async () => {
    pages({ 'https://bikeshop.be/headwind': { status: 'dead', text: '' } })
    const { picks } = await engine(new StepModel({}), search(() => HITS)).research({ ideaId: 1, text: 'fan' })
    expect(picks.map((p) => p.title)).toEqual(['Lasko fan'])
    expect(picks[0].rank).toBe(1)
  })

  it('keeps offers whose page could not be checked (bot walls)', async () => {
    pages({ 'https://www.bol.com/be/nl/p/lasko/123': { status: 'unknown', text: '' } })
    const { picks } = await engine(new StepModel({}), search(() => HITS)).research({ ideaId: 1, text: 'fan' })
    expect(picks).toHaveLength(2)
  })

  it('tries the next model when candidates use URLs outside the search results', async () => {
    const liar = new StepModel({
      candidates: { candidates: [{ title: 'Made up', shop: 'X', url: 'https://invented.example/p' }] },
    })
    const { picks } = await engine(liar, search(() => HITS), [new StepModel({})]).research({ ideaId: 1, text: 'fan' })
    expect(picks[0].title).toBe('Wahoo KICKR Headwind')
  })

  it('falls back to the shortlist when verification keeps nothing', async () => {
    const { picks } = await engine(new StepModel({ verify: { picks: [] } }), search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
    })
    expect(picks.map((p) => [p.title, p.price])).toEqual([
      ['Wahoo KICKR Headwind', 229],
      ['Lasko fan', 59],
    ])
  })

  it('asks for rewording when the searches find nothing', async () => {
    const err = (await engine(new StepModel({}), search(() => []))
      .research({ ideaId: 1, text: 'fan' })
      .catch((e: unknown) => e)) as ResearchError
    expect(err).toBeInstanceOf(ResearchError)
    expect(err.kind).toBe('no-results')
  })

  it('surfaces a refused search key instead of "no results", and stops searching', async () => {
    const refused = new ResearchError('Serper refused the search (HTTP 403)', { kind: 'unavailable', status: 403 })
    const provider = search(() => refused)
    const plan = { summary: '', criteria: [], searchQueries: ['a', 'b', 'c'] }
    const err = (await engine(new StepModel({ plan }), provider)
      .research({ ideaId: 1, text: 'fan' })
      .catch((e: unknown) => e)) as ResearchError
    expect(err.kind).toBe('unavailable')
    expect(err.message).toContain('Serper refused')
    expect(provider.queries).toEqual(['a'])
  })

  it('tolerates one failing query when others return results', async () => {
    const plan = { summary: '', criteria: [], searchQueries: ['broken', 'works'] }
    const provider = search((q) => (q === 'broken' ? new ResearchError('bad query', { kind: 'invalid' }) : HITS))
    const { picks } = await engine(new StepModel({ plan }), provider).research({ ideaId: 1, text: 'fan' })
    expect(picks).toHaveLength(2)
  })
})

function shown(over: Partial<HistoryPick>): HistoryPick {
  return { round: 1, title: 'Old fan', shop: 'Shop', price: null, why: null, reaction: null, reason: null, urls: [], ...over }
}

function history(picks: HistoryPick[], over: Partial<ResearchHistory> = {}): ResearchHistory {
  return {
    mode: 'learn',
    preferences: { summary: 'a fan', mustHaves: ['quiet'], avoid: [], likes: [] },
    preferencesEdited: false,
    picks,
    ...over,
  }
}

async function rejection(p: Promise<unknown>): Promise<ResearchError> {
  return (await p.catch((e: unknown) => e)) as ResearchError
}

describe('PipelineEngine refine rounds', () => {
  const HEADWIND = 'https://bikeshop.be/headwind'
  const LASKO = 'https://www.bol.com/be/nl/p/lasko/123'

  it('round 1 plans and returns a title with preferences', async () => {
    const plan = { title: 'Indoor cycling fan', summary: 'a fan', criteria: ['quiet', 'strong'], searchQueries: ['fan'] }
    const { brief } = await engine(new StepModel({ plan }), search(() => HITS)).research({ ideaId: 1, text: 'fan' })
    expect(brief.title).toBe('Indoor cycling fan')
    expect(brief.preferences.mustHaves).toEqual(['quiet', 'strong'])
  })

  it('keeps the current title when the model gives none', async () => {
    const { brief } = await engine(new StepModel({}), search(() => HITS)).research({ ideaId: 1, text: 'fan', title: 'Mine' })
    expect(brief.title).toBe('Mine')
  })

  it('a refine learns instead of planning, and shows reasons to the model', async () => {
    const model = new StepModel({})
    const steps: string[] = []
    const { brief } = await engine(model, search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ title: 'Loud fan', reaction: 'no', reason: 'too loud', urls: ['https://x.be/loud'] })]),
      onProgress: (s) => steps.push(s),
    })
    expect(model.systems.some((s) => s.includes('planning step'))).toBe(false)
    expect(model.learnPrompt).toContain('too loud')
    expect(steps).toContain('learning from your reactions')
    expect(brief).toMatchObject({ title: 'Quiet cycling fan', preferences: { avoid: ['loud fans'] } })
  })

  it('keeps owner-edited preference items through the learn step', async () => {
    const owner = { summary: 'owner words', mustHaves: ['white'], avoid: ['plastic'], likes: [] }
    const { brief } = await engine(new StepModel({}), search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ reaction: 'no' })], { preferences: owner, preferencesEdited: true }),
    })
    expect(brief.preferences).toEqual({
      summary: 'owner words',
      mustHaves: ['white', 'quiet'],
      avoid: ['plastic', 'loud fans'],
      likes: [],
    })
  })

  it("never repeats an earlier product: by supplier URL, by title, and by the verifier's repeatOf", async () => {
    // Supplier URL: the history pick was bought elsewhere but also offered at the Headwind hit.
    const bySupplier = new StepModel({})
    const r1 = await engine(bySupplier, search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ title: 'Something', urls: ['https://elsewhere.be/x', `${HEADWIND}?utm_source=x`] })]),
    })
    expect(r1.picks.map((p) => p.url)).toEqual([LASKO])
    expect(bySupplier.prompts.find((p) => p.includes('Candidates:'))).not.toContain(HEADWIND)

    // Title: the same product at a new URL.
    const r2 = await engine(new StepModel({}), search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ title: 'Lasko Fan.', urls: ['https://other.be/lasko'] })]),
    })
    expect(r2.picks.map((p) => p.title)).toEqual(['Wahoo KICKR Headwind'])

    // repeatOf: the verifier recognises an earlier model under another name.
    const verify = {
      picks: [
        { title: 'Wahoo Headwind fan', why: 'w', repeatOf: 1, suppliers: [{ shop: 'B', url: HEADWIND, price: '229' }] },
        { title: 'Lasko fan', why: 'w', repeatOf: 0, suppliers: [{ shop: 'bol', url: LASKO, price: '59' }] },
      ],
    }
    const model = new StepModel({ verify })
    const r3 = await engine(model, search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ title: 'KICKR Headwind Smart', urls: ['https://other.be/hw'] })]),
    })
    expect(r3.picks.map((p) => p.title)).toEqual(['Lasko fan'])
    expect(model.verifyPrompt).toContain('1. KICKR Headwind Smart')
  })

  it('stops before the candidate step when every search hit was shown before', async () => {
    const model = new StepModel({})
    const err = await rejection(
      engine(model, search(() => HITS)).research({
        ideaId: 1,
        text: 'fan',
        history: history([shown({ urls: [HEADWIND] }), shown({ urls: [LASKO] })]),
      }),
    )
    expect(err).toMatchObject({ kind: 'no-results', message: NOTHING_NEW })
    expect(model.systems.some((s) => s.includes('candidate-selection'))).toBe(false)
  })

  it('tries the next model, then stops with nothing new, when candidates only repeat by title', async () => {
    const second = new StepModel({})
    const err = await rejection(
      engine(new StepModel({}), search(() => HITS), [second]).research({
        ideaId: 1,
        text: 'fan',
        history: history([
          shown({ title: 'Wahoo KICKR Headwind', urls: ['https://a.be/1'] }),
          shown({ title: 'Lasko fan', urls: ['https://a.be/2'] }),
        ]),
      }),
    )
    expect(second.systems.some((s) => s.includes('candidate-selection'))).toBe(true)
    expect(err).toMatchObject({ kind: 'no-results', message: NOTHING_NEW })
  })

  it('a model with only repeats then a model with invented URLs is retryable, not nothing-new', async () => {
    const liar = new StepModel({
      candidates: { candidates: [{ title: 'Made up', shop: 'X', url: 'https://invented.example/p' }] },
    })
    const err = await rejection(
      engine(new StepModel({}), search(() => HITS), [liar]).research({
        ideaId: 1,
        text: 'fan',
        history: history([
          shown({ title: 'Wahoo KICKR Headwind', urls: ['https://a.be/1'] }),
          shown({ title: 'Lasko fan', urls: ['https://a.be/2'] }),
        ]),
      }),
    )
    expect(err.kind).toBe('invalid')
  })

  it('a model with only repeats then a model failing with invalid JSON is retryable, not nothing-new', async () => {
    const broken = new StepModel({})
    broken.generate = async () => {
      throw new ResearchError('bad json', { kind: 'invalid' })
    }
    const err = await rejection(
      engine(new StepModel({}), search(() => HITS), [broken]).research({
        ideaId: 1,
        text: 'fan',
        history: history([
          shown({ title: 'Wahoo KICKR Headwind', urls: ['https://a.be/1'] }),
          shown({ title: 'Lasko fan', urls: ['https://a.be/2'] }),
        ]),
      }),
    )
    expect(err).toMatchObject({ kind: 'invalid', message: 'bad json' })
  })

  it('does not count shown hits toward the search cap', async () => {
    const old = Array.from({ length: 24 }, (_, i) => ({ title: `Old ${i}`, url: `https://old.be/${i}`, snippet: '' }))
    const learn = {
      title: 't',
      preferences: { summary: 's', mustHaves: [], avoid: [], likes: [] },
      searchQueries: ['first', 'second'],
    }
    const provider = search((q) => (q === 'first' ? old : HITS))
    const { picks } = await engine(new StepModel({ learn }), provider).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ urls: old.map((h) => h.url) })]),
    })
    expect(provider.queries).toEqual(['first', 'second'])
    expect(picks.map((p) => p.title)).toEqual(['Wahoo KICKR Headwind', 'Lasko fan'])
  })

  it('falls back to the shortlist in a refine when the verifier returns nothing', async () => {
    const { picks } = await engine(new StepModel({ verify: { picks: [] } }), search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ round: 2, urls: ['https://old.be/1'] })]),
    })
    expect(picks.map((p) => p.title)).toEqual(['Wahoo KICKR Headwind', 'Lasko fan'])
  })

  it('stops with nothing new when the verifier only names repeats', async () => {
    const verify = {
      picks: [{ title: 'Lasko fan', why: 'w', repeatOf: 1, suppliers: [{ shop: 'bol', url: LASKO, price: '59' }] }],
    }
    const err = await rejection(
      engine(new StepModel({ verify }), search(() => HITS)).research({
        ideaId: 1,
        text: 'fan',
        history: history([shown({ title: 'Lasko 123', urls: ['https://old.be/1'] })]),
      }),
    )
    expect(err).toMatchObject({ kind: 'no-results', message: NOTHING_NEW })
  })

  it('a fresh start plans again but still excludes rejected products', async () => {
    const model = new StepModel({})
    const { picks } = await engine(model, search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([shown({ title: 'Lasko', reaction: 'no', urls: [LASKO] })], { mode: 'fresh' }),
    })
    expect(model.systems[0]).toContain('planning step')
    expect(model.learnPrompt).toBe('')
    expect(picks.flatMap((p) => p.suppliers.map((s) => s.url))).not.toContain(LASKO)
  })

  it('excludes a reacted pick from an older round', async () => {
    const { picks } = await engine(new StepModel({}), search(() => HITS)).research({
      ideaId: 1,
      text: 'fan',
      history: history([
        shown({ round: 3, title: 'Newer', urls: ['https://new.be/1'] }),
        shown({ round: 1, title: 'Headwind old', reaction: 'maybe', urls: [HEADWIND] }),
      ]),
    })
    expect(picks.map((p) => p.url)).toEqual([LASKO])
  })
})

describe('SerperProvider', () => {
  afterEach(() => vi.unstubAllGlobals())

  function serper(response: Response) {
    vi.stubGlobal('fetch', vi.fn(async () => response))
    return new SerperProvider('key').search('fan')
  }

  it('links shopping results to the offer page, never the image, with source and price', async () => {
    const hits = await serper(
      Response.json({
        organic: [{ title: 'Review', link: 'https://review.example/fan', snippet: 'best fans' }],
        shopping: [
          { title: 'Fan A', link: 'https://shop.example/a', imageUrl: 'https://img.example/a.jpg', source: 'Coolblue', price: '€59,99' },
          { title: 'Fan B', imageUrl: 'https://img.example/b.jpg' },
        ],
      }),
    )
    expect(hits).toEqual([
      { title: 'Review', url: 'https://review.example/fan', snippet: 'best fans' },
      { title: 'Fan A', url: 'https://shop.example/a', snippet: 'Coolblue · €59,99' },
    ])
  })

  it('maps spent credits and bad keys to unavailable, rate limits to transient', async () => {
    const credits = await serper(new Response('{"message":"Not enough credits"}', { status: 400 })).catch((e) => e)
    expect(credits).toMatchObject({ kind: 'unavailable' })
    const key = await serper(new Response('Unauthorized', { status: 403 })).catch((e) => e)
    expect(key).toMatchObject({ kind: 'unavailable' })
    const limited = await serper(new Response('slow', { status: 429 })).catch((e) => e)
    expect(limited).toMatchObject({ kind: 'transient', retryAfterMs: 10_000 })
  })
})
