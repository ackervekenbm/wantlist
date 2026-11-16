import type { FinalPick, HuntTarget, ResearchRequest, ResearchResult } from '../../types'
import { ResearchError } from './errors'
import {
  buildOfferUser,
  buildSelectUser,
  normalizeOffers,
  normalizeSelect,
  OFFER_SCHEMA,
  OFFER_SYSTEM,
  SELECT_SCHEMA,
  SELECT_SYSTEM,
} from './huntPrompts'
import type { ModelRouter } from './llm'
import { exclusionOf, normalizeUrl } from './offers'
import { offer } from './prompts'
import { rankOffers } from './rank'
import type { SearchProvider } from './search'
import { checkedSupplier, mapLimit, PAGE_CONCURRENCY, searchAll, type PageCache, type Sleep } from './shared'

export const HUNT_NOTHING = 'No shop sells exactly this right now. Loosen the target or try again later.'

export interface HuntDeps {
  router: ModelRouter
  search: SearchProvider
  cache: PageCache
  step: (s: string) => void
  log: (s: string) => void
  sleep?: Sleep
}

export interface HuntPlan {
  target: HuntTarget
  refill: boolean | null
  title: string
  searchQueries: string[]
}

const nothing = () => new ResearchError(HUNT_NOTHING, { kind: 'no-results' })

/** One exact product: find every shop's offer page, read the facts, rank by delivered price. */
export async function runHunt(deps: HuntDeps, req: ResearchRequest, plan: HuntPlan): Promise<ResearchResult> {
  const { router, cache, step, log } = deps
  const { target } = plan

  step('looking for every shop that sells it')
  // A hunt starts over every round: nothing the owner saw is excluded.
  const { rows } = await searchAll(deps.search, plan.searchQueries, log, exclusionOf([]), deps.sleep)

  step('picking the offer pages')
  const allowed = new Set(rows.map((r) => normalizeUrl(r.url)))
  const selected = await router.generate(
    {
      systemInstruction: SELECT_SYSTEM,
      contents: buildSelectUser(target, rows),
      schema: SELECT_SCHEMA,
      temperature: 0.2,
    },
    (raw) => normalizeSelect(raw, allowed),
  )

  step(`reading ${selected.length} shop pages`)
  const read = await mapLimit(selected, PAGE_CONCURRENCY, async (s) => ({
    s,
    page: await cache.get(s.url),
  }))
  const live = read.filter((r) => r.page.status !== 'dead')
  if (live.length === 0) throw nothing()

  step('checking match, packs and delivery')
  const urls = new Set(live.map((r) => r.s.url))
  const facts = await router.generate(
    {
      systemInstruction: OFFER_SYSTEM,
      contents: buildOfferUser(
        target,
        live.map(({ s, page }) => ({
          url: s.url,
          title: page.title,
          text: page.text,
          product: page.product,
        })),
      ),
      schema: OFFER_SCHEMA,
      temperature: 0.1,
    },
    (raw) => {
      const out = normalizeOffers(raw, urls)
      if (out.length === 0)
        throw new ResearchError('no offer facts for the pages', {
          kind: 'invalid',
        })
      return out
    },
  )

  const byUrl = new Map(live.map((r) => [normalizeUrl(r.s.url), r]))
  const offers = facts.flatMap((f): FinalPick[] => {
    const hit = byUrl.get(normalizeUrl(f.url))
    const supplier = hit ? checkedSupplier(offer(hit.s.shop, hit.s.url, hit.s.price), hit.page) : null
    // A page that only states stock gave no shop price: the shown price is the snippet's, so not checked.
    if (supplier && hit?.page.product?.price == null) supplier.checked = false
    if (!hit || !supplier) return []
    return [
      {
        rank: 0,
        kind: 'offer',
        offer: { ...f.facts, delivered: null, perUnit: null, group: 'exact' },
        title: f.title || hit.s.title,
        shop: supplier.shop ?? hit.s.shop,
        url: supplier.url,
        price: supplier.price,
        why: f.facts.sellerNote ?? '',
        caveat: f.facts.mismatch,
        image: hit.page.product?.image ?? null,
        rating: hit.page.product?.rating ?? null,
        suppliers: [supplier],
        sourceUrls: [supplier.url],
      },
    ]
  })

  step('ranking by delivered price')
  const picks = rankOffers(offers, target)
  if (!picks.some((p) => p.offer?.group === 'best')) throw nothing()
  return {
    brief: {
      title: plan.title || (req.title ?? ''),
      preferences: req.history?.preferences ?? {
        summary: '',
        mustHaves: [],
        avoid: [],
        likes: [],
      },
      mode: 'hunt',
      target,
      refill: plan.refill,
    },
    picks,
  }
}
