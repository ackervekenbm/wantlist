import type {
  FinalPick,
  HistoryPick,
  PickSupplier,
  Preferences,
  ResearchCandidate,
  ResearchEngine,
  ResearchRequest,
  ResearchResult,
} from '../../types'
import { NOTHING_NEW, NOT_SHOP_PAGES, ResearchError } from './errors'
import type { ModelRouter } from './llm'
import type { Page } from './http'
import {
  type Exclusion,
  exclusionOf,
  isExcluded,
  mergePicksByProduct,
  mergeSuppliers,
  normalizeUrl,
  primaryFields,
  rankPicks,
} from './offers'
import {
  buildCandidateUser,
  buildMoreQueriesUser,
  type CandidateInputRow,
  buildQueryUser,
  buildLearnUser,
  buildVerifyUser,
  CANDIDATE_SCHEMA,
  CANDIDATE_SYSTEM,
  capPreferences,
  keepOwnerItems,
  LEARN_SCHEMA,
  LEARN_SYSTEM,
  MAX_CANDIDATES,
  MORE_QUERIES_SCHEMA,
  MORE_QUERIES_SYSTEM,
  normalizeMoreQueries,
  normalizeLearn,
  normalizePass1,
  normalizePass2,
  normalizePlan,
  offer,
  QUERY_SCHEMA,
  QUERY_SYSTEM,
  shownForPrompt,
  verifySchema,
  VERIFY_SYSTEM,
} from './prompts'
import { runHunt } from './hunt'
import type { PartnerSaving } from './rank'
import { buildHuntPlanUser, HUNT_PLAN_SCHEMA, HUNT_PLAN_SYSTEM, normalizeHuntPlan } from './huntPrompts'
import { checkedSupplier, mapLimit, PAGE_CONCURRENCY, PageCache, searchAll } from './shared'
import type { SearchProvider } from './search'

/** Product pages read before a round stops browsing and searching. */
const ENOUGH_PAGES = 6
/** Shortlist passes per round: the search results, then category pages' products or a new search. */
const MAX_PASSES = 3
/** Candidates the verify step weighs; each brings up to 12k characters of page text. */
const MAX_VERIFY = 12

export interface PipelineEngineOptions {
  router: ModelRouter
  search: SearchProvider
  maxCandidatesToFetch?: number
  onProgress?: (message: string) => void
  /** Injectable sleep for tests (search retries). */
  sleep?: (ms: number) => Promise<void>
  /** EUR back from the owner's partner programs, counted when ranking hunt offers. */
  partnerSaving?: PartnerSaving
}

export class PipelineEngine implements ResearchEngine {
  constructor(private readonly opts: PipelineEngineOptions) {}

  async research(request: ResearchRequest): Promise<ResearchResult> {
    const log = this.opts.onProgress ?? (() => {})
    const progress = (msg: string) => log(`#${request.ideaId} ${msg}`)
    const step = request.onProgress ?? (() => {})
    const router = this.opts.router

    const huntDeps = () => ({
      router,
      search: this.opts.search,
      cache: new PageCache(),
      step,
      log: progress,
      sleep: this.opts.sleep,
      partnerSaving: this.opts.partnerSaving,
    })
    if (request.mode === 'hunt') {
      step('working out what to look for')
      progress('hunt: planning')
      const hp = await router.generate(
        {
          systemInstruction: HUNT_PLAN_SYSTEM,
          contents: buildHuntPlanUser(request),
          schema: HUNT_PLAN_SCHEMA,
          temperature: 0.3,
        },
        (raw) => normalizeHuntPlan(raw, request.target ?? null, !!request.targetByOwner),
      )
      return runHunt(huntDeps(), request, hp)
    }

    const history = request.history ?? null
    const ex = exclusionOf(history?.picks ?? [])
    const shown = shownForPrompt(history?.picks ?? [])
    const nothingNew = () => new ResearchError(NOTHING_NEW, { kind: 'no-results' })

    let plan: { title: string; preferences: Preferences; searchQueries: string[] }
    if (history?.mode === 'learn') {
      step('learning from your reactions')
      progress('step 1: learning from reactions')
      const learned = await router.generate(
        {
          systemInstruction: LEARN_SYSTEM,
          contents: buildLearnUser(request, request.title ?? null, history),
          schema: LEARN_SCHEMA,
          temperature: 0.4,
        },
        normalizeLearn,
      )
      const owner = history.preferencesEdited ? history.preferences : null
      plan = owner ? { ...learned, preferences: keepOwnerItems(learned.preferences, owner) } : learned
    } else {
      step('working out what to look for')
      progress('step 1: planning queries')
      const p = await router.generate(
        {
          systemInstruction: QUERY_SYSTEM,
          contents: buildQueryUser(request),
          schema: QUERY_SCHEMA,
          temperature: 0.4,
        },
        normalizePlan,
      )
      // Round 1 may turn out to be a hunt, unless the owner chose the mode.
      if (!request.modeByOwner && p.mode === 'hunt' && p.target) {
        return runHunt(huntDeps(), request, { target: p.target, refill: p.refill, title: p.title, searchQueries: p.searchQueries })
      }
      const preferences = capPreferences({ summary: p.summary, mustHaves: p.criteria, avoid: [], likes: [] })
      plan = { title: p.title, preferences, searchQueries: p.searchQueries }
    }
    progress(`step 1: ${plan.searchQueries.length} query(ies)`)
    const preferences = plan.preferences

    step('searching shops and reviews')
    const first = await searchAll(this.opts.search, plan.searchQueries, progress, ex, this.opts.sleep)
    if (first.rows.length === 0 && first.excludedAny) throw nothingNew()
    progress(`step 2: ${first.rows.length} search hits`)

    // Shortlist, read, browse the category pages that turn up, search again: until enough product pages are read.
    const pageCache = new PageCache()
    const maxFetch = this.opts.maxCandidatesToFetch ?? MAX_CANDIDATES
    const tried = [...plan.searchQueries]
    const offered = new Set<string>()
    const read: Array<{ candidate: ResearchCandidate; page: Page }> = []
    let notShop = 0
    let rows = first.rows
    for (let pass = 1; ; pass++) {
      const fresh = rows.filter((r) => !offered.has(normalizeUrl(r.url)))
      fresh.forEach((r) => offered.add(normalizeUrl(r.url)))
      rows = []
      if (fresh.length > 0) {
        step(`shortlisting from ${fresh.length} results`)
        const shortlist = await this.shortlist(request, preferences, fresh, shown, ex, pass === 1)
        progress(`step 2: pass ${pass}, ${shortlist.length} candidates`)
        step(`reading ${Math.min(shortlist.length, maxFetch)} pages`)
        const opened = await mapLimit(shortlist.slice(0, maxFetch), PAGE_CONCURRENCY, async (candidate) => ({
          candidate,
          page: await pageCache.get(candidate.url),
        }))
        for (const r of opened) {
          // A category or review page has nothing to buy: it never becomes a pick, but a category's products are browsed.
          if (!r.page.kind) read.push(r)
          else {
            notShop++
            for (const l of r.page.links ?? []) {
              if (!ex.urls.has(normalizeUrl(l.url))) rows.push({ title: l.title, url: l.url, snippet: `on ${r.candidate.shop}'s ${r.candidate.title} page` })
            }
          }
        }
      }
      if (read.filter((r) => r.page.text).length >= ENOUGH_PAGES || pass >= MAX_PASSES) break
      if (rows.length === 0) {
        step('searching again')
        const found = read.map((r) => r.candidate.title)
        const more = await router
          .generate(
            {
              systemInstruction: MORE_QUERIES_SYSTEM,
              contents: buildMoreQueriesUser(request, preferences, tried, found),
              schema: MORE_QUERIES_SCHEMA,
              temperature: 0.5,
            },
            (raw) => normalizeMoreQueries(raw, tried),
          )
          .catch((err: unknown) => (progress(`step 2: no new queries: ${(err as Error).message}`), []))
        if (more.length === 0) break
        tried.push(...more)
        rows = await searchAll(this.opts.search, more, progress, ex, this.opts.sleep).then(
          (r) => r.rows,
          () => [],
        )
      }
    }
    if (read.length === 0) throw new ResearchError(NOT_SHOP_PAGES, { kind: 'no-results' })
    const kept = read.slice(0, MAX_VERIFY)
    const candidates = kept.map((r) => r.candidate)
    const pages = kept
      .filter((r) => r.page.text)
      .map((r) => ({ url: r.candidate.url, title: r.page.title, text: r.page.text, product: r.page.product }))
    const fetchErrors = kept.filter((r) => !r.page.text).map((r) => r.candidate.url)
    progress(`step 3: read ${pages.length}/${kept.length} pages, ${notShop} not shop pages`)

    step('checking the evidence')
    progress('step 4: verifying')
    const verified = await router.generate(
      {
        systemInstruction: VERIFY_SYSTEM,
        contents: buildVerifyUser({
          idea: request,
          preferences,
          shown,
          candidates,
          pages,
          fetchErrors,
        }),
        schema: verifySchema(shown.length > 0),
        temperature: 0.3,
      },
      (raw) => normalizePass2(raw, candidates, shown.length),
    )
    let picks = verified.picks.filter((p) => !isExcluded(p, ex))
    if (picks.length === 0) {
      if (verified.repeats > 0 || verified.picks.length > 0) throw nothingNew()
      // The verifier kept nothing at all: pass-1 candidates are already filtered, so they are new.
      picks = this.fallbackFromPass1(candidates)
    }

    step(`checking ${picks.reduce((n, p) => n + p.suppliers.length, 0)} offers at the shops`)
    progress('step 5: checking offers')
    picks = await this.checkOffers(picks, pageCache)
    const sourceUrls = pages.map((p) => p.url)

    return {
      brief: { title: plan.title || (request.title ?? ''), preferences },
      picks: rankPicks(picks.map((p) => ({ ...p, sourceUrls }))),
    }
  }

  /**
   * The model's shortlist from these rows. The first pass fails the round
   * like any step (only repeats: nothing new); a later one that fails only
   * ends the browsing, so the round goes on with what it has.
   */
  private async shortlist(
    request: ResearchRequest,
    preferences: Preferences,
    rows: CandidateInputRow[],
    shown: HistoryPick[],
    ex: Exclusion,
    first: boolean,
  ): Promise<ResearchCandidate[]> {
    const allowed = new Set(rows.map((r) => normalizeUrl(r.url)))
    // Only this exact error (from the latest model's parse) means "nothing new"; any other invalid stays retryable.
    const onlyRepeats = new ResearchError('every candidate was shown before', { kind: 'invalid' })
    return this.opts.router
      .generate(
        {
          systemInstruction: CANDIDATE_SYSTEM,
          contents: buildCandidateUser(request, preferences, rows, shown),
          schema: CANDIDATE_SCHEMA,
          temperature: 0.3,
        },
        (raw) => {
          const parsed = normalizePass1(raw, allowed, (c) => isExcluded(c, ex))
          if (parsed.candidates.length === 0 && normalizePass1(raw, allowed).candidates.length > 0) {
            // Not no-results here: the router rethrows unknown kinds at once and would skip the chain.
            throw onlyRepeats
          }
          if (parsed.candidates.length === 0) {
            throw new ResearchError('no candidate used a URL from the search results', { kind: 'invalid' })
          }
          return parsed.candidates
        },
      )
      .catch((err: unknown) => {
        if (!first) return []
        throw err === onlyRepeats ? new ResearchError(NOTHING_NEW, { kind: 'no-results' }) : err
      })
  }

  private fallbackFromPass1(candidates: ResearchCandidate[]): FinalPick[] {
    return mergePicksByProduct(
      candidates.map((c) => {
        const suppliers = [offer(c.shop, c.url, c.price)]
        return {
          rank: 0,
          title: c.title,
          ...primaryFields(suppliers),
          why: c.why ?? '',
          caveat: null,
          image: null,
          rating: null,
          suppliers,
          sourceUrls: [],
        }
      }),
    )
  }

  /**
   * Opens every offer's page once (pages already read for verification are
   * reused): dead links are dropped, and price, stock, photo and rating come
   * from the shop's own product data when it has some. A pick with no live
   * offer left is dropped; so are picks out of stock everywhere, unless
   * nothing else is left. Otherwise the model's order stands.
   */
  private async checkOffers(picks: FinalPick[], cache: PageCache): Promise<FinalPick[]> {
    const urls = [...new Set(picks.flatMap((p) => p.suppliers.map((s) => s.url)))]
    await mapLimit(urls, PAGE_CONCURRENCY, (url) => cache.get(url))

    const checked: FinalPick[] = []
    for (const pick of picks) {
      const offers: PickSupplier[] = []
      let image = pick.image
      let rating = pick.rating
      for (const s of pick.suppliers) {
        const page = await cache.get(s.url)
        const supplier = checkedSupplier(s, page)
        if (!supplier) continue
        offers.push(supplier)
        image ??= page.product?.image ?? null
        rating ??= page.product?.rating ?? null
      }
      if (offers.length === 0) continue
      const suppliers = mergeSuppliers(offers)
      checked.push({ ...pick, ...primaryFields(suppliers), suppliers, image, rating })
    }
    const soldOut = (p: FinalPick) => p.suppliers.every((s) => s.availability === 'out_of_stock')
    const buyable = checked.filter((p) => !soldOut(p))
    return buyable.length > 0 ? buyable : checked
  }
}
