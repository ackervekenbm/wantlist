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
import { rankOffers, type PartnerSaving } from './rank'
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
  partnerSaving?: PartnerSaving
}

export interface HuntPlan {
  target: HuntTarget
  refill: boolean | null
  title: string
  searchQueries: string[]
}

/** Shop pages followed from referral links, on top of the selected ones. */
const MAX_FOLLOWED = 3

export const UNREADABLE = "Couldn't read this shop's page (it may block automated visits): open it to check the price and stock."

/** A shop page that could not be read: listed with the search price, never checked, never best. */
function unreadOffer(s: { url: string; shop: string; title: string; price: number | null }): FinalPick {
  const supplier = offer(s.shop, s.url, s.price)
  return {
    rank: 0,
    kind: 'offer',
    offer: {
      match: 'exact',
      mismatch: null,
      packs: 1,
      unitsPerPack: null,
      delivery: { kind: 'unknown', cost: null, threshold: null },
      delivered: null,
      perUnit: null,
      condition: null,
      sellerNote: UNREADABLE,
      group: 'exact',
    },
    title: s.title,
    shop: s.shop,
    url: s.url,
    price: supplier.price,
    why: UNREADABLE,
    caveat: null,
    image: null,
    rating: null,
    suppliers: [supplier],
    sourceUrls: [s.url],
  }
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

  // The shops of the pick the hunt started from are read even when search misses them.
  const picked = new Set(selected.map((s) => normalizeUrl(s.url)))
  const toRead = [
    ...selected,
    ...(req.huntFrom ?? [])
      .filter((h) => !picked.has(normalizeUrl(h.url)) && picked.add(normalizeUrl(h.url)))
      .map((h) => ({ ...h, price: null })),
  ]
  step(`reading ${toRead.length} shop pages`)
  const read = await mapLimit(toRead, PAGE_CONCURRENCY, async (s) => ({
    s,
    page: await cache.get(s.url),
  }))
  // Unreadable pages (bot checks, shop errors) are listed for the owner to check, never sent to the model.
  const live = read.filter((r) => r.page.status === 'live')
  const blind = read.filter((r) => r.page.status === 'unknown').map((r) => unreadOffer(r.s))

  // A referral site's buy link carries the shop page that really sells: read that one too.
  const known = new Set(read.map((r) => normalizeUrl(r.s.url)))
  const followed = live
    .flatMap((r) => r.page.referrals ?? [])
    .filter((url) => !known.has(normalizeUrl(url)) && known.add(normalizeUrl(url)))
    .slice(0, MAX_FOLLOWED)
  if (followed.length > 0) {
    step(`reading ${followed.length} shop pages linked from comparison sites`)
    const extra = await mapLimit(followed, PAGE_CONCURRENCY, async (url) => ({
      s: { url, shop: new URL(url).hostname.replace(/^www\./, ''), title: '', price: null },
      page: await cache.get(url),
    }))
    // An unreadable link target is dropped, not listed: there is nothing to name it by.
    live.push(...extra.filter((r) => r.page.status === 'live'))
  }
  if (live.length === 0 && blind.length === 0) throw nothing()

  step('checking match, packs and delivery')
  const urls = new Set(live.map((r) => r.s.url))
  const facts = live.length === 0 ? [] : await router.generate(
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
  // A page that only sends buyers elsewhere is not an offer; the shop it links to is.
  const offers = facts.filter((f) => !f.referral).flatMap((f): FinalPick[] => {
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
  const picks = rankOffers([...offers, ...blind], target, deps.partnerSaving)
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
