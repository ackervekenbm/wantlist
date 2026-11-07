import { vi } from 'vitest'
import type { Idea, IdeaPatch, Pick, ServerStatus } from '../../types'

/** A pick with sensible defaults; override what the test is about. */
export function pick(over: Partial<Pick> = {}): Pick {
  const base: Pick = {
    id: 1,
    ideaId: 1,
    rank: 1,
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
    attempts: 0,
    nextAttemptAt: null,
    summary: 'A strong, quiet fan aimed at you on the trainer',
    criteria: ['airflow', 'noise', 'price'],
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
export function fakeApi(initial: Idea[] = [], serverStatus: ServerStatus = status()) {
  let ideas = [...initial]
  let nextId = Math.max(0, ...initial.map((i) => i.id)) + 1
  const calls: Array<{ method: string; path: string; body: unknown }> = []

  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), { status: code, headers: { 'Content-Type': 'application/json' } })

  const fetch = vi.fn(async (input: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET'
    const body: unknown = init.body ? JSON.parse(String(init.body)) : undefined
    calls.push({ method, path: input, body })
    const m = /^\/api\/ideas\/(\d+)(\/rerun)?$/.exec(input)
    const id = m ? Number(m[1]) : null
    const found = id !== null ? ideas.find((i) => i.id === id) : undefined

    if (input === '/api/status') return json(serverStatus)
    if (input === '/api/ideas' && method === 'GET') return json(ideas)
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
        summary: null,
        criteria: [],
        picks: [],
      })
      ideas = [created, ...ideas]
      return json(created, 201)
    }
    if (!found) return json({ error: 'not found' }, 404)
    if (method === 'DELETE') {
      ideas = ideas.filter((i) => i.id !== id)
      return new Response(null, { status: 204 })
    }
    if (method === 'PATCH') {
      const p = body as IdeaPatch
      const chosen = p.boughtPickId != null ? found.picks.find((x) => x.id === p.boughtPickId) : null
      const updated: Idea = {
        ...found,
        ...(p.text !== undefined && { text: p.text }),
        ...(p.budget !== undefined && { budget: p.budget }),
        ...(p.notes !== undefined && { notes: p.notes }),
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
    if (m?.[2] && method === 'POST') {
      const updated: Idea = { ...found, status: 'queued', list: 'wanted', bought: null, error: null }
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
    /** Requests other than the polling GETs. */
    writes: () => calls.filter((c) => c.method !== 'GET'),
  }
}
