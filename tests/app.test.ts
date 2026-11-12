import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { MAX_IDEA_LENGTH, createApp } from '../src/server/app'
import { REASON_MAX } from '../src/types/limits'
import { claimIdea, completeIdea, createIdea, failIdea, getIdea, requeueIdea, type WlDb } from '../src/server/db'
import type { Worker } from '../src/server/worker'
import { researchResult, tempDb, tempDir } from './helpers'

function fakeWorker() {
  return {
    runOnce: vi.fn(async () => ({ attempted: 0, succeeded: 0, failed: 0, retrying: 0, message: 'ok' })),
    kick: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    state: () => ({ running: true, lastRunAt: null, lastRunResult: null, current: { ideaId: 1, step: 'searching' } }),
  } satisfies Worker
}

function setup(opts: { missingKeys?: string[]; clientDist?: string } = {}) {
  const { db } = tempDb()
  const worker = fakeWorker()
  const app = createApp({ db, worker, missingKeys: opts.missingKeys ?? [], clientDist: opts.clientDist })
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
    failIdea(db, failed, 'boom', null)
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
