import fs from 'node:fs'
import path from 'node:path'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { MAX_IDEA_LENGTH, createApp } from '../src/server/app'
import { claimIdea, completeIdea, createIdea, failIdea, getIdea, type WlDb } from '../src/server/db'
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
