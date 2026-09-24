import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  createIdea,
  deleteIdea,
  getIdea,
  listIdeas,
  openDb,
  replacePicks,
  requeueIdea,
  setIdeaStatus,
  type WlDb,
} from '../src/server/db'
import type { Pick } from '../src/types'

function makeDb(): { db: WlDb; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wantlist-test-'))
  return { db: openDb(dir), dir }
}

function samplePicks(ideaId: number): Pick[] {
  return [
    {
      id: 0,
      ideaId,
      rank: 1,
      title: 'A fan',
      shop: 'Shop Be',
      url: 'https://shop.be/fan',
      price: '89',
      why: 'quiet at low rpm',
      sourceUrls: ['https://shop.be/fan'],
      fetchedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 0,
      ideaId,
      rank: 2,
      title: 'A second fan',
      shop: 'Other Shop',
      url: 'https://other.eu/fan2',
      price: null,
      why: null,
      sourceUrls: [],
      fetchedAt: null,
    },
  ]
}

describe('db', () => {
  it('creates and lists ideas with status queued', () => {
    const { db, dir } = makeDb()
    const id = createIdea(db, '  a good fan for my bike  ')
    const ideas = listIdeas(db)
    expect(ideas).toHaveLength(1)
    expect(ideas[0].text).toBe('a good fan for my bike')
    expect(ideas[0].status).toBe('queued')
    expect(ideas[0].picks).toEqual([])
    deleteIdea(db, id)
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('round-trips picks and status transition', () => {
    const { db, dir } = makeDb()
    const id = createIdea(db, 'wireless earbuds')
    setIdeaStatus(db, id, 'researching')
    expect(getIdea(db, id)?.status).toBe('researching')
    expect(getIdea(db, id)?.researchedAt).toBeNull()

    replacePicks(db, id, samplePicks(id))
    setIdeaStatus(db, id, 'done')

    const idea = getIdea(db, id) as NonNullable<ReturnType<typeof getIdea>>
    expect(idea.status).toBe('done')
    expect(idea.error).toBeNull()
    expect(idea.researchedAt).not.toBeNull()
    expect(idea.picks).toHaveLength(2)
    expect(idea.picks[0].title).toBe('A fan')
    expect(idea.picks[0].sourceUrls).toEqual(['https://shop.be/fan'])
    expect(idea.picks[0].fetchedAt).not.toBeNull()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('requeue clears picks and error so a rerun starts clean', () => {
    const { db, dir } = makeDb()
    const id = createIdea(db, 'jacket')
    setIdeaStatus(db, id, 'error', 'boom')
    replacePicks(db, id, samplePicks(id))
    requeueIdea(db, id)
    const idea = getIdea(db, id) as NonNullable<ReturnType<typeof getIdea>>
    expect(idea.status).toBe('queued')
    expect(idea.error).toBeNull()
    expect(idea.picks).toEqual([])
    deleteIdea(db, id)
    expect(getIdea(db, id)).toBeNull()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('delete cascades picks', () => {
    const { db, dir } = makeDb()
    const id = createIdea(db, 'lamp')
    replacePicks(db, id, samplePicks(id))
    expect(getIdea(db, id)?.picks).toHaveLength(2)
    deleteIdea(db, id)
    expect(getIdea(db, id)).toBeNull()
    db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
})