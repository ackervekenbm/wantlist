import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { MAX_IDEA_LENGTH, createApp, type AppOptions } from './app'
import { REASON_MAX } from '../types/limits'
import { claimIdea, completeIdea, createIdea, failIdea, getIdea, requeueIdea, type WlDb } from './db'
import type { Delivery, FinalPick, Idea } from '../types'
import { rankOffers } from './research/rank'
import type { Worker } from './worker'
import { researchResult, tempDb, tempDir } from './test/helpers'

function fakeWorker() {
  return {
    runOnce: vi.fn(async () => ({ attempted: 0, succeeded: 0, failed: 0, retrying: 0, message: 'ok' })),
    kick: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    state: () => ({ running: true, lastRunAt: null, lastRunResult: null, current: { ideaId: 1, step: 'searching' } }),
  } satisfies Worker
}

function setup(opts: { missingKeys?: string[]; clientDist?: string; partners?: AppOptions['partners'] } = {}) {
  const { db } = tempDb()
  const worker = fakeWorker()
  const app = createApp({ db, worker, missingKeys: opts.missingKeys ?? [], clientDist: opts.clientDist, partners: opts.partners })
  return { db, worker, api: request(app) }
}

function seedDone(db: WlDb): number {
  const id = createIdea(db, 'fan')
  claimIdea(db, id)
  completeIdea(db, id, researchResult())
  return id
}

describe('API', () => {
  it('reports health', async () => {
    const { api } = setup()
    await api.get('/api/health').expect(200, { ok: true })
  })

  it('reports status, including why research is off', async () => {
    const { db, api } = setup({ missingKeys: ['SERPER_API_KEY'] })
    createIdea(db, 'fan')
    const res = await api.get('/api/status').expect(200)
    expect(res.body).toMatchObject({
      researchEnabled: false,
      missingKeys: ['SERPER_API_KEY'],
      queuedCount: 1,
      running: true,
      current: { ideaId: 1, step: 'searching' },
    })
  })

  it('adds an idea, returns it whole, and wakes the worker', async () => {
    const { api, worker } = setup()
    const res = await api.post('/api/ideas').send({ text: '  a quiet fan  ' }).expect(201)
    expect(res.body).toMatchObject({ id: 1, text: 'a quiet fan', status: 'queued', picks: [] })
    expect(worker.kick).toHaveBeenCalledOnce()
    const list = await api.get('/api/ideas').expect(200)
    expect(list.body).toHaveLength(1)
    expect(list.body[0]).toHaveProperty('errorKind', null)
  })

  it('validates new ideas', async () => {
    const { api, worker } = setup()
    await api.post('/api/ideas').send({}).expect(400, { error: 'text is required' })
    await api.post('/api/ideas').send({ text: '   ' }).expect(400)
    await api.post('/api/ideas').send({ text: 42 }).expect(400)
    await api.post('/api/ideas').send({ text: 'x'.repeat(MAX_IDEA_LENGTH + 1) }).expect(400)
    expect(worker.kick).not.toHaveBeenCalled()
  })

  it('takes an optional budget and notes', async () => {
    const { api } = setup()
    const res = await api
      .post('/api/ideas')
      .send({ text: 'running shoes', budget: 120, notes: '  wide feet  ' })
      .expect(201)
    expect(res.body).toMatchObject({ budget: 120, notes: 'wide feet', list: 'wanted', bought: null })
    await api.post('/api/ideas').send({ text: 'x', budget: -5 }).expect(400)
    await api.post('/api/ideas').send({ text: 'x', budget: '120' }).expect(400)
    await api.post('/api/ideas').send({ text: 'x', notes: 7 }).expect(400)
    await api.post('/api/ideas').send({ text: 'x', notes: 'n'.repeat(501) }).expect(400)
    const cleared = await api.post('/api/ideas').send({ text: 'x', budget: null, notes: '' }).expect(201)
    expect(cleared.body).toMatchObject({ budget: null, notes: null })
  })

  it('answers malformed JSON with a 400, not a crash', async () => {
    const { api } = setup()
    const res = await api.post('/api/ideas').set('Content-Type', 'application/json').send('{"text":').expect(400)
    expect(res.body.error).toBeTruthy()
  })

  it('gets one idea, 404s unknown ones and rejects bad ids', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const res = await api.get(`/api/ideas/${id}`).expect(200)
    expect(res.body.picks).toHaveLength(2)
    await api.get('/api/ideas/999').expect(404)
    await api.get('/api/ideas/abc').expect(400)
    await api.get('/api/ideas/1.5').expect(400)
  })

  it('deletes an idea and 404s the second time', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    await api.delete(`/api/ideas/${id}`).expect(204)
    await api.delete(`/api/ideas/${id}`).expect(404)
  })

  it('re-runs an idea, keeping its picks until new ones arrive', async () => {
    const { db, api, worker } = setup()
    const id = seedDone(db)
    const res = await api.post(`/api/ideas/${id}/rerun`).expect(202)
    expect(res.body).toMatchObject({ status: 'queued', error: null })
    expect(res.body.picks).toHaveLength(2)
    expect(worker.kick).toHaveBeenCalledOnce()
  })

  it('re-runs a failed idea and refuses one being researched', async () => {
    const { db, api } = setup()
    const failed = createIdea(db, 'a')
    claimIdea(db, failed)
    failIdea(db, failed, 'boom', null, 'stopped')
    await api.post(`/api/ideas/${failed}/rerun`).expect(202)

    const busy = createIdea(db, 'b')
    claimIdea(db, busy)
    await api.post(`/api/ideas/${busy}/rerun`).expect(409)
    await api.post('/api/ideas/999/rerun').expect(404)
  })

  it('edits text, budget and notes', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const res = await api.patch(`/api/ideas/${id}`).send({ text: 'a quiet fan', budget: 150.555, notes: 'white' }).expect(200)
    expect(res.body).toMatchObject({ text: 'a quiet fan', budget: 150.56, notes: 'white', status: 'done' })
    const cleared = await api.patch(`/api/ideas/${id}`).send({ budget: null, notes: null }).expect(200)
    expect(cleared.body).toMatchObject({ budget: null, notes: null })
  })

  it('marks an idea bought with a snapshot of the chosen pick', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const pick = getIdea(db, id)!.picks[0]
    const res = await api.patch(`/api/ideas/${id}`).send({ list: 'bought', boughtPickId: pick.id }).expect(200)
    expect(res.body.list).toBe('bought')
    expect(res.body.bought).toMatchObject({ title: 'A fan', shop: 'Shop Be', url: 'https://shop.be/fan', price: 89 })
    expect(Date.parse(res.body.bought.at)).not.toBeNaN()

    // Bought something else: no snapshot. Back to wanted: snapshot cleared.
    const other = await api.patch(`/api/ideas/${id}`).send({ list: 'bought', boughtPickId: null }).expect(200)
    expect(other.body.bought).toBeNull()
    await api.patch(`/api/ideas/${id}`).send({ list: 'bought', boughtPickId: pick.id }).expect(200)
    const back = await api.patch(`/api/ideas/${id}`).send({ list: 'wanted' }).expect(200)
    expect(back.body).toMatchObject({ list: 'wanted', bought: null })
  })

  it('validates edits', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const otherIdea = seedDone(db)
    const foreignPick = getIdea(db, otherIdea)!.picks[0].id
    await api.patch(`/api/ideas/${id}`).send({}).expect(400, { error: 'nothing to change' })
    await api.patch(`/api/ideas/${id}`).send({ list: 'trash' }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ text: '' }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ boughtPickId: 1 }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ list: 'bought', boughtPickId: foreignPick }).expect(400)
    await api.patch('/api/ideas/999').send({ list: 'archived' }).expect(404)
  })

  it('wakes the worker when a queued idea is wanted again', async () => {
    const { db, api, worker } = setup()
    const id = createIdea(db, 'fan')
    await api.patch(`/api/ideas/${id}`).send({ list: 'archived' }).expect(200)
    expect(worker.kick).not.toHaveBeenCalled()
    await api.patch(`/api/ideas/${id}`).send({ list: 'wanted' }).expect(200)
    expect(worker.kick).toHaveBeenCalledOnce()
  })

  it('returns JSON 404s for unknown API routes', async () => {
    const { api } = setup()
    await api.get('/api/nope').expect(404, { error: 'not found' })
  })
})

describe('client hosting', () => {
  function dist(): string {
    const dir = tempDir()
    fs.mkdirSync(path.join(dir, 'assets'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>wantlist</title>')
    fs.writeFileSync(path.join(dir, 'assets', 'index-abc123.js'), 'console.log(1)')
    return dir
  }

  it('serves the shell no-cache and fingerprinted assets immutable', async () => {
    const { api } = setup({ clientDist: dist() })
    const shell = await api.get('/').expect(200)
    expect(shell.headers['cache-control']).toBe('no-cache')
    const asset = await api.get('/assets/index-abc123.js').expect(200)
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable')
  })

  it('falls back to the shell for client routes but not for the API', async () => {
    const { api } = setup({ clientDist: dist() })
    const res = await api.get('/some/route').expect(200)
    expect(res.text).toContain('<title>wantlist</title>')
    expect(res.headers['cache-control']).toBe('no-cache')
    await api.get('/api/missing').expect(404)
  })
})

describe('API: refine rounds', () => {
  it('reacts to a pick with a reason, and validates it', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const [a, b] = getIdea(db, id)!.picks
    const res = await api.patch(`/api/picks/${a.id}`).send({ reaction: 'no', reason: ' too loud ' }).expect(200)
    expect(res.body.picks.find((p: { id: number }) => p.id === a.id)).toMatchObject({ reaction: 'no', reason: 'too loud' })
    await api.patch(`/api/picks/${a.id}`).send({ reaction: 'love' }).expect(400)
    await api.patch(`/api/picks/${a.id}`).send({ reason: 'x'.repeat(REASON_MAX + 1) }).expect(400)
    await api.patch(`/api/picks/${a.id}`).send({}).expect(400)
    const blank = await api.patch(`/api/picks/${a.id}`).send({ reason: '   ' }).expect(200)
    expect(blank.body.picks.find((p: { id: number }) => p.id === a.id).reason).toBeNull()
    await api.patch(`/api/picks/${b.id + 100}`).send({ reaction: 'yes' }).expect(404)
    await api.patch('/api/picks/abc').send({ reaction: 'yes' }).expect(400)
  })

  it('renames and un-names an idea', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    await api.patch(`/api/ideas/${id}`).send({ title: 'x'.repeat(61) }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ title: '  ' }).expect(400)
    const named = await api.patch(`/api/ideas/${id}`).send({ title: ' Mine ' }).expect(200)
    expect(named.body).toMatchObject({ title: 'Mine', titleByOwner: true })
    const cleared = await api.patch(`/api/ideas/${id}`).send({ title: null }).expect(200)
    expect(cleared.body.titleByOwner).toBe(false)
  })

  it('edits preferences within the limits, not mid-round', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const prefs = { summary: 'quiet', mustHaves: ['usb'], avoid: [], likes: ['small'] }
    const ok = await api.patch(`/api/ideas/${id}`).send({ preferences: prefs }).expect(200)
    expect(ok.body).toMatchObject({ preferences: prefs, preferencesEdited: true })
    await api.patch(`/api/ideas/${id}`).send({ preferences: { ...prefs, likes: Array(13).fill('a') } }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ preferences: { ...prefs, likes: [' '] } }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ preferences: { summary: 'q', mustHaves: [], avoid: [] } }).expect(400)
    requeueIdea(db, id, { requireSignal: false })
    claimIdea(db, id)
    const busy = await api.patch(`/api/ideas/${id}`).send({ preferences: prefs }).expect(409)
    expect(busy.body).toEqual({ error: 'a round is in progress' })
    await api.patch(`/api/ideas/${id}`).send({ text: 'a different fan' }).expect(409)
    await api.patch(`/api/ideas/${id}`).send({ budget: 50 }).expect(200)
  })

  it('refines only with something to learn from', async () => {
    const { db, api, worker } = setup()
    const id = seedDone(db)
    const res = await api.post(`/api/ideas/${id}/refine`).expect(400)
    expect(res.body).toEqual({ error: 'react to a pick or edit the preferences first' })
    await api.patch(`/api/picks/${getIdea(db, id)!.picks[0].id}`).send({ reaction: 'no' }).expect(200)
    const ok = await api.post(`/api/ideas/${id}/refine`).expect(202)
    expect(ok.body.status).toBe('queued')
    expect(worker.kick).toHaveBeenCalledOnce()
    claimIdea(db, id)
    await api.post(`/api/ideas/${id}/refine`).expect(409)
    await api.post('/api/ideas/999/refine').expect(404)
  })

  it('refining a bought idea puts it back on the wanted list', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const pick = getIdea(db, id)!.picks[0]
    await api.patch(`/api/ideas/${id}`).send({ list: 'bought', boughtPickId: pick.id }).expect(200)
    await api.patch(`/api/picks/${pick.id}`).send({ reaction: 'yes' }).expect(200)
    const res = await api.post(`/api/ideas/${id}/refine`).expect(202)
    expect(res.body).toMatchObject({ list: 'wanted', bought: null })
  })

  it('rerun needs no reactions', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    await api.post(`/api/ideas/${id}/rerun`).expect(202)
  })
})

describe('hunt routes', () => {
  const target = { product: 'Feliway refill', variant: '48 ml', condition: 'new', exclude: [], unit: null }
  const pickOf = (db: WlDb, id: number) => getIdea(db, id)!.picks[0].id

  it('starts a hunt from a pick: 202, kicks, and maps errors', async () => {
    const { db, api, worker } = setup()
    const id = seedDone(db)
    const res = await api.post(`/api/ideas/${id}/hunt`).send({ pickId: pickOf(db, id) }).expect(202)
    expect(res.body).toMatchObject({ mode: 'hunt', status: 'queued' })
    expect(worker.kick).toHaveBeenCalledOnce()
    await api.post(`/api/ideas/${id}/hunt`).send({ pickId: 9999 }).expect(400)
    await api.post(`/api/ideas/${id}/hunt`).send({}).expect(400)
    await api.post('/api/ideas/99/hunt').send({ pickId: 1 }).expect(404)
    claimIdea(db, id)
    await api.post(`/api/ideas/${id}/hunt`).send({ pickId: 1 }).expect(409)
  })

  it('records a purchase (201), validates it, and undoes it', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const pickId = pickOf(db, id)
    const res = await api.post(`/api/ideas/${id}/purchases`).send({ pickId, paid: 59.95, refill: false }).expect(201)
    expect(res.body).toMatchObject({ list: 'bought', purchases: [{ paid: 59.95 }] })
    await api.post(`/api/ideas/${id}/purchases`).send({ pickId: null, paid: 5, refill: false }).expect(201)
    for (const bad of [{ pickId, paid: 0, refill: true }, { pickId, paid: 2_000_000, refill: true }, { pickId, paid: 5 }, { paid: 5, refill: true }, { pickId: 9999, paid: 5, refill: true }])
      await api.post(`/api/ideas/${id}/purchases`).send(bad).expect(400)
    await api.post('/api/ideas/99/purchases').send({ pickId: null, paid: 5, refill: true }).expect(404)
    const undone = await api.delete(`/api/purchases/${res.body.purchases[0].id}`).expect(200)
    expect(undone.body.id).toBe(id)
    await api.delete('/api/purchases/9999').expect(404)
  })

  it('running low queues a covered idea once, then 409', async () => {
    const { db, api, worker } = setup()
    const id = seedDone(db)
    await api.post(`/api/ideas/${id}/running-low`).expect(409)
    await api.post(`/api/ideas/${id}/hunt`).send({ pickId: pickOf(db, id) }).expect(202)
    claimIdea(db, id)
    completeIdea(db, id, researchResult())
    await api.post(`/api/ideas/${id}/purchases`).send({ pickId: null, paid: 5, refill: true }).expect(201)
    worker.kick.mockClear()
    await api.post(`/api/ideas/${id}/running-low`).expect(202)
    expect(worker.kick).toHaveBeenCalledOnce()
    await api.post(`/api/ideas/${id}/running-low`).expect(409)
    await api.post('/api/ideas/99/running-low').expect(404)
  })

  it('PATCH a hunt offer with your delivery cost re-ranks the hunt, and null clears it', async () => {
    const { db, api } = setup()
    const id = createIdea(db, 'pedals')
    claimIdea(db, id)
    const offer = (shop: string, price: number, delivery: Delivery): FinalPick => ({
      rank: 0,
      title: 'Shimano PD-RS500',
      shop,
      url: `https://${shop}.be/pd-rs500`,
      price,
      why: '',
      caveat: null,
      image: null,
      rating: null,
      sourceUrls: [],
      suppliers: [{ shop, url: `https://${shop}.be/pd-rs500`, price, availability: 'in_stock', checked: true }],
      kind: 'offer',
      offer: { match: 'exact', mismatch: null, packs: 1, unitsPerPack: 1, delivery, delivered: null, perUnit: null, condition: 'new', sellerNote: null, group: 'exact' },
    })
    const hunt = { ...target, product: 'Shimano PD-RS500' }
    const offers = rankOffers(
      [offer('delta', 40, { kind: 'free_over', cost: null, threshold: 49 }), offer('mantel', 43, { kind: 'free', cost: null, threshold: null })],
      { ...hunt, condition: 'new' },
    )
    completeIdea(db, id, { ...researchResult(offers), brief: { ...researchResult().brief, mode: 'hunt', target: { ...hunt, condition: 'new' } } })
    const delta = getIdea(db, id)!.picks.find((p) => p.shop === 'delta')!
    expect(delta.offer?.group).toBe('best') // an unknown delivery wins on its lower item price

    const res = await api.patch(`/api/picks/${delta.id}`).send({ delivery: 4.95 }).expect(200)
    const after = (shop: string) => (res.body as Idea).picks.find((p) => p.shop === shop)!
    expect(after('delta').offer).toMatchObject({ delivery: { kind: 'paid', cost: 4.95 }, delivered: 44.95, group: 'exact', foundDelivery: { kind: 'free_over', threshold: 49 } })
    expect(after('mantel').offer).toMatchObject({ delivered: 43, group: 'best' })
    expect(after('mantel').rank).toBeLessThan(after('delta').rank)

    const free = await api.patch(`/api/picks/${delta.id}`).send({ delivery: 0 }).expect(200)
    expect((free.body as Idea).picks.find((p) => p.shop === 'delta')!.offer).toMatchObject({ delivery: { kind: 'free' }, delivered: 40, group: 'best' })

    const cleared = await api.patch(`/api/picks/${delta.id}`).send({ delivery: null }).expect(200)
    const back = (cleared.body as Idea).picks.find((p) => p.shop === 'delta')!.offer!
    expect(back.delivery).toEqual({ kind: 'free_over', cost: null, threshold: 49 })
    expect(back).not.toHaveProperty('foundDelivery')

    for (const bad of [-1, 1001, 'x', 4.951]) await api.patch(`/api/picks/${delta.id}`).send({ delivery: bad }).expect(400)
    const explore = seedDone(db)
    await api.patch(`/api/picks/${pickOf(db, explore)}`).send({ delivery: 5 }).expect(400)
    await api.patch('/api/picks/9999').send({ delivery: 5 }).expect(404)
  })

  it('PATCH takes mode and target and validates them', async () => {
    const { db, api } = setup()
    const id = seedDone(db)
    const res = await api.patch(`/api/ideas/${id}`).send({ target }).expect(200)
    expect(res.body.target).toEqual(target)
    await api.patch(`/api/ideas/${id}`).send({ target: { ...target, exclude: Array(7).fill('x') } }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ target: { ...target, condition: 'broken' } }).expect(400)
    await api.patch(`/api/ideas/${id}`).send({ mode: 'nope' }).expect(400)
    expect((await api.patch(`/api/ideas/${id}`).send({ mode: 'hunt' }).expect(200)).body.mode).toBe('hunt')
    claimIdea(db, id)
    await api.patch(`/api/ideas/${id}`).send({ mode: 'explore' }).expect(409)
  })
})

describe('partner deals', () => {
  it('fills each shop offer with its partner deal in the list and the single idea', async () => {
    const partner = { program: 'Viking Deals', percent: 2, percentMax: 2, saving: 1, scope: null, until: null, link: 'https://p/' }
    const partners = {
      withPartners: (idea: Idea) => ({ ...idea, picks: idea.picks.map((p) => ({ ...p, suppliers: p.suppliers.map((s) => ({ ...s, partner })) })) }),
    }
    const { db, api } = setup({ partners })
    const id = seedDone(db)
    const list = await api.get('/api/ideas').expect(200)
    expect(list.body[0].picks[0].suppliers[0].partner).toEqual(partner)
    const one = await api.get(`/api/ideas/${id}`).expect(200)
    expect(one.body.picks[0].suppliers[0].partner).toEqual(partner)
  })
})
