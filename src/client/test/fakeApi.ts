import { vi } from 'vitest'
import { isCovered, type Idea, type IdeaPatch, type NewPurchase, type OfferFacts, type Pick, type PickPatch, type Purchase, type ServerStatus } from '../../types'

/** A pick with sensible defaults; override what the test is about. */
export function pick(over: Partial<Pick> = {}): Pick {
  const base: Pick = {
    id: 1,
    round: 1,
    reaction: null,
    reason: null,
    ideaId: 1,
    rank: 1,
    kind: 'pick',
    offer: null,
    title: 'Wahoo KICKR Headwind',
    shop: 'Bikeshop',
    url: 'https://bikeshop.be/headwind',
    price: 249.99,
    why: 'Fan speed follows your heart rate',
    caveat: 'Pricey for a fan',
    image: 'https://bikeshop.be/headwind.jpg',
    rating: { value: 4.6, count: 88 },
    sourceUrls: [],
    fetchedAt: '2026-11-06T10:00:00.000Z',
    suppliers: [
      { shop: 'Bikeshop', url: 'https://bikeshop.be/headwind', price: 249.99, availability: 'in_stock', checked: true },
      { shop: 'bol', url: 'https://www.bol.com/be/nl/p/headwind/1', price: 259, availability: 'unknown', checked: false },
    ],
  }
  return { ...base, ...over }
}

export function idea(over: Partial<Idea> = {}): Idea {
  return {
    id: 1,
    text: 'A fan for my indoor bike setup',
    budget: null,
    notes: null,
    list: 'wanted',
    bought: null,
    status: 'done',
    createdAt: '2026-11-05T10:00:00Z',
    researchedAt: '2026-11-06T10:00:00.000Z',
    error: null,
    errorKind: null,
    attempts: 0,
    nextAttemptAt: null,
    title: null,
    titleByOwner: false,
    round: 1,
    preferences: {
      summary: 'A strong, quiet fan aimed at you on the trainer',
      mustHaves: ['airflow', 'noise', 'price'],
      avoid: [],
      likes: [],
    },
    preferencesEdited: false,
    freshSinceRound: null,
    mode: 'explore',
    modeByOwner: false,
    target: null,
    targetByOwner: false,
    refill: null,
    purchases: [],
    picks: [pick()],
    ...over,
  }
}

export function status(over: Partial<ServerStatus> = {}): ServerStatus {
  return {
    researchEnabled: true,
    missingKeys: [],
    running: false,
    lastRunAt: null,
    lastRunResult: null,
    queuedCount: 0,
    current: null,
    models: [{ id: 'gemini:gemini-3.8-flash', benchedUntil: null, reason: null }],
    ...over,
  }
}

/**
 * An in-memory stand-in for the server behind `fetch`. Records every
 * request so tests can assert on what the UI sent.
 */
/** The server's delivery override, without re-ranking. */
function ownDelivery(o: OfferFacts, price: number | null, cost: number | null): OfferFacts {
  const { foundDelivery, ...rest } = o
  const found = foundDelivery ?? o.delivery
  if (cost === null) return { ...rest, delivery: found, delivered: found.kind === 'free' ? price : null }
  return { ...rest, foundDelivery: found, delivery: { kind: cost === 0 ? 'free' : 'paid', cost, threshold: null }, delivered: price === null ? null : price + cost }
}

export function fakeApi(initial: Idea[] = [], serverStatus: ServerStatus = status()) {
  let ideas = [...initial]
  let nextId = Math.max(0, ...initial.map((i) => i.id)) + 1
  let nextPurchaseId = 1
  let failPickOnce = false
  let heldList: Promise<void> | null = null
  const calls: Array<{ method: string; path: string; body: unknown }> = []

  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })

  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: input, body })
    const m = /^\/api\/ideas\/(\d+)(?:\/(rerun|refine|hunt|purchases|running-low|pantry))?$/.exec(input)
    const id = m ? Number(m[1]) : null
    const found = id !== null ? ideas.find((i) => i.id === id) : undefined

    if (input === '/api/status') return json(serverStatus)
    if (input === '/api/ideas' && method === 'GET') {
      const snapshot = ideas
      const hold = heldList
      heldList = null
      if (hold) await hold
      return json(snapshot)
    }
    const pm = /^\/api\/picks\/(\d+)$/.exec(input)
    if (pm && method === 'PATCH') {
      if (failPickOnce) {
        failPickOnce = false
        return json({ error: 'database is locked' }, 500)
      }
      const pickId = Number(pm[1])
      const owner = ideas.find((i) => i.picks.some((x) => x.id === pickId))
      if (!owner) return json({ error: 'not found' }, 404)
      const p = body as PickPatch
      const updated: Idea = {
        ...owner,
        picks: owner.picks.map((x) => {
          if (x.id !== pickId) return x
          const reaction = p.reaction !== undefined ? p.reaction : x.reaction
          const reason = reaction === null ? null : p.reason !== undefined ? p.reason?.trim() || null : x.reason
          const offer = p.delivery === undefined || !x.offer ? x.offer : ownDelivery(x.offer, x.price, p.delivery)
          return { ...x, reaction, reason, offer }
        }),
      }
      ideas = ideas.map((i) => (i.id === owner.id ? updated : i))
      return json(updated)
    }
    if (input === '/api/ideas' && method === 'POST') {
      const b = body as { text: string; budget?: number | null; notes?: string | null }
      if (b.text === 'fail') return json({ error: 'text is longer than 500 characters' }, 400)
      const created = idea({
        id: nextId++,
        text: b.text,
        budget: b.budget ?? null,
        notes: b.notes ?? null,
        status: 'queued',
        researchedAt: null,
        round: 0,
        preferences: null,
        title: null,
        picks: [],
      })
      ideas = [created, ...ideas]
      return json(created, 201)
    }
    const pu = /^\/api\/purchases\/(\d+)$/.exec(input)
    if (pu && method === 'DELETE') {
      const purchaseId = Number(pu[1])
      const owner = ideas.find((i) => i.purchases.some((x) => x.id === purchaseId))
      if (!owner) return json({ error: 'not found' }, 404)
      const newest = owner.purchases[0].id === purchaseId
      const updated: Idea = {
        ...owner,
        purchases: owner.purchases.filter((x) => x.id !== purchaseId),
        ...(newest && { list: 'wanted' as const, bought: null }),
      }
      ideas = ideas.map((i) => (i.id === owner.id ? updated : i))
      return json(updated)
    }
    if (!found) return json({ error: 'not found' }, 404)
    if (method === 'DELETE') {
      ideas = ideas.filter((i) => i.id !== id)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      if (found.text === 'broken') return json({ error: 'database is locked' }, 500)
      const p = body as IdeaPatch
      if ((p.mode !== undefined || p.target !== undefined) && found.status === 'researching') {
        return json({ error: 'being researched right now' }, 409)
      }
      // A mode without picks of its kind has to be researched first.
      const needsRun = p.mode !== undefined && !found.picks.some((x) => x.kind === (p.mode === 'hunt' ? 'offer' : 'pick'))
      const chosen = p.boughtPickId != null ? found.picks.find((x) => x.id === p.boughtPickId) : null
      const updated: Idea = {
        ...found,
        ...(p.text !== undefined && { text: p.text }),
        ...(p.budget !== undefined && { budget: p.budget }),
        ...(p.notes !== undefined && { notes: p.notes }),
        ...(p.mode !== undefined && { mode: p.mode, modeByOwner: true }),
        ...(p.target !== undefined && { target: p.target, targetByOwner: p.target !== null }),
        ...(needsRun && { status: 'queued' as const, list: 'wanted' as const, bought: null }),
        ...(p.title !== undefined && { title: p.title, titleByOwner: p.title !== null }),
        ...(p.preferences !== undefined && { preferences: p.preferences, preferencesEdited: true }),
        ...(p.list !== undefined && {
          list: p.list,
          bought:
            p.list === 'bought' && chosen
              ? { title: chosen.title, shop: chosen.shop, url: chosen.url, price: chosen.price, at: '2026-11-07T10:00:00.000Z' }
              : null,
        }),
      }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated)
    }
    if (m?.[2] === 'hunt' && method === 'POST') {
      if (found.status === 'researching') return json({ error: 'being researched right now' }, 409)
      const { pickId } = body as { pickId: number }
      if (!found.picks.some((x) => x.id === pickId)) return json({ error: 'no such pick' }, 400)
      const updated: Idea = { ...found, mode: 'hunt', modeByOwner: true, status: 'queued', list: 'wanted', bought: null }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated, 202)
    }
    if (m?.[2] === 'purchases' && method === 'POST') {
      const b = body as NewPurchase
      const chosen = b.pickId !== null ? found.picks.find((x) => x.id === b.pickId) : undefined
      if (b.pickId !== null && !chosen) return json({ error: 'no such pick' }, 400)
      const purchase: Purchase = {
        id: nextPurchaseId++,
        ideaId: found.id,
        at: '2026-11-07T10:00:00.000Z',
        shop: chosen?.shop ?? null,
        url: chosen?.url ?? null,
        title: chosen?.title ?? found.title ?? found.text,
        packs: chosen?.offer?.packs ?? 1,
        unitsPerPack: chosen?.offer?.unitsPerPack ?? null,
        unitLabel: found.target?.unit ?? null,
        paid: b.paid,
        perUnit: chosen?.offer?.perUnit ?? null,
      }
      const updated: Idea = {
        ...found,
        list: 'bought',
        refill: b.refill,
        purchases: [purchase, ...found.purchases],
        bought: chosen
          ? { title: chosen.title, shop: chosen.shop, url: chosen.url, price: b.paid, at: purchase.at }
          : null,
      }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated, 201)
    }
    if (m?.[2] === 'pantry' && method === 'POST') {
      if (found.list !== 'bought') return json({ error: 'not bought' }, 409)
      const product = found.bought?.title ?? found.title ?? found.text
      const updated: Idea = {
        ...found,
        mode: 'hunt',
        modeByOwner: true,
        refill: true,
        target: found.target ?? { product, variant: '', condition: 'new', exclude: [], unit: null },
      }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated)
    }
    if (m?.[2] === 'running-low' && method === 'POST') {
      if (!isCovered(found)) return json({ error: 'not covered' }, 409)
      const updated: Idea = { ...found, status: 'queued', list: 'wanted', bought: null }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated, 202)
    }
    if (m?.[2] === 'refine' && method === 'POST') {
      if (!found.picks.some((x) => x.reaction) && !found.preferencesEdited) {
        return json({ error: 'react to a pick or edit the preferences first' }, 400)
      }
    }
    if (m?.[2] && method === 'POST') {
      const updated: Idea = { ...found, status: 'queued', list: 'wanted', bought: null, error: null, errorKind: null }
      ideas = ideas.map((i) => (i.id === id ? updated : i))
      return json(updated, 202)
    }
    return json({ error: 'unexpected request' }, 500)
  })

  vi.stubGlobal('fetch', fetch)
  return {
    fetch,
    calls,
    ideas: () => ideas,
    /** The next pick PATCH answers 500. */
    failNextPickPatch: () => {
      failPickOnce = true
    },
    /** The next GET /api/ideas answers only after the returned function is called. */
    holdNextList: () => {
      let release!: () => void
      heldList = new Promise<void>((r) => (release = r))
      return release
    },
    /** Requests other than the polling GETs. */
    writes: () => calls.filter((c) => c.method !== 'GET'),
  }
}
