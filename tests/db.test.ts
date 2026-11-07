import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  SCHEMA_VERSION,
  claimIdea,
  completeIdea,
  countQueued,
  createIdea,
  deleteIdea,
  dueIdeaIds,
  failIdea,
  getIdea,
  listIdeas,
  nextScheduledAttempt,
  openDb,
  recoverInterrupted,
  requeueIdea,
} from '../src/server/db'
import { finalPicks, tempDb, tempDir } from './helpers'

describe('ideas', () => {
  it('creates trimmed queued ideas, newest first, with ISO timestamps', () => {
    const { db } = tempDb()
    createIdea(db, '  a good fan for my bike  ')
    createIdea(db, 'a lamp')
    const ideas = listIdeas(db)
    expect(ideas.map((i) => i.text)).toEqual(['a lamp', 'a good fan for my bike'])
    expect(ideas[1]).toMatchObject({ status: 'queued', attempts: 0, nextAttemptAt: null, picks: [] })
    expect(ideas[1].createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
  })

  it('stores picks and marks done in one step', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'wireless earbuds')
    expect(claimIdea(db, id)).toBe(true)
    expect(getIdea(db, id)?.status).toBe('researching')

    expect(completeIdea(db, id, finalPicks(), new Date('2026-11-01T10:00:00Z'))).toBe(true)
    const idea = getIdea(db, id)!
    expect(idea).toMatchObject({ status: 'done', error: null, researchedAt: '2026-11-01T10:00:00.000Z' })
    expect(idea.picks.map((p) => p.title)).toEqual(['A fan', 'A second fan'])
    expect(idea.picks[0].suppliers[1]).toEqual({ shop: 'Alt Shop', url: 'https://alt.eu/fan', price: '99' })
    expect(idea.picks[0].fetchedAt).toBe('2026-11-01T10:00:00.000Z')
  })

  it('lists picks with their own idea', () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    completeIdea(db, a, finalPicks())
    completeIdea(db, b, finalPicks().slice(0, 1))
    const byId = new Map(listIdeas(db).map((i) => [i.id, i]))
    expect(byId.get(a)?.picks).toHaveLength(2)
    expect(byId.get(b)?.picks).toHaveLength(1)
    expect(byId.get(b)?.picks[0].ideaId).toBe(b)
  })

  it('does not resurrect an idea deleted mid-research', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'lamp')
    claimIdea(db, id)
    deleteIdea(db, id)
    expect(completeIdea(db, id, finalPicks())).toBe(false)
    expect(getIdea(db, id)).toBeNull()
  })

  it('claims only queued ideas', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'lamp')
    expect(claimIdea(db, id)).toBe(true)
    expect(claimIdea(db, id)).toBe(false)
    expect(claimIdea(db, 999)).toBe(false)
  })

  it('delete reports whether the idea existed and cascades picks', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'lamp')
    completeIdea(db, id, finalPicks())
    expect(deleteIdea(db, id)).toBe(true)
    expect(deleteIdea(db, id)).toBe(false)
    expect((db.prepare('SELECT COUNT(*) AS n FROM picks').get() as { n: number }).n).toBe(0)
  })
})

describe('failures and retries', () => {
  const now = new Date('2026-11-07T12:00:00Z')

  it('a scheduled retry stays queued, keeps old picks, and is due only at its time', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'jacket')
    completeIdea(db, id, finalPicks())
    requeueIdea(db, id)
    claimIdea(db, id)
    failIdea(db, id, 'quota', new Date('2026-11-07T13:00:00Z'))

    const idea = getIdea(db, id)!
    expect(idea).toMatchObject({ status: 'queued', error: 'quota', attempts: 1 })
    expect(idea.nextAttemptAt).toBe('2026-11-07T13:00:00.000Z')
    expect(idea.picks).toHaveLength(2)

    expect(dueIdeaIds(db, 10, now)).toEqual([])
    expect(dueIdeaIds(db, 10, new Date('2026-11-07T13:00:00Z'))).toEqual([id])
    expect(nextScheduledAttempt(db, now)?.toISOString()).toBe('2026-11-07T13:00:00.000Z')
    expect(countQueued(db)).toBe(1)
  })

  it('a permanent failure stops at error and leaves the queue', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'jacket')
    claimIdea(db, id)
    failIdea(db, id, 'bad request', null)
    expect(getIdea(db, id)).toMatchObject({ status: 'error', error: 'bad request', attempts: 1 })
    expect(dueIdeaIds(db, 10, now)).toEqual([])
    expect(countQueued(db)).toBe(0)
  })

  it('success clears the error and the retry budget', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'jacket')
    claimIdea(db, id)
    failIdea(db, id, 'quota', new Date(0))
    claimIdea(db, id)
    completeIdea(db, id, finalPicks())
    expect(getIdea(db, id)).toMatchObject({ status: 'done', error: null, attempts: 0, nextAttemptAt: null })
  })

  it('manual re-run requeues now with a clean budget, but not mid-research', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'jacket')
    claimIdea(db, id)
    expect(requeueIdea(db, id)).toBe(false)
    failIdea(db, id, 'boom', null)
    expect(requeueIdea(db, id)).toBe(true)
    expect(getIdea(db, id)).toMatchObject({ status: 'queued', error: null, attempts: 0, nextAttemptAt: null })
    expect(dueIdeaIds(db, 10, now)).toEqual([id])
  })

  it('requeues ideas interrupted by a restart', () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    claimIdea(db, a)
    expect(recoverInterrupted(db)).toBe(1)
    expect(dueIdeaIds(db, 10, now)).toEqual([a, b])
  })
})

describe('migrations', () => {
  it('upgrades a pre-versioning database in place', () => {
    const dir = tempDir()
    const old = new Database(path.join(dir, 'wantlist.db'))
    old.exec(`
      CREATE TABLE ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT (datetime('now')), researched_at TEXT, error TEXT);
      CREATE TABLE picks (id INTEGER PRIMARY KEY AUTOINCREMENT, idea_id INTEGER NOT NULL, rank INTEGER NOT NULL, title TEXT NOT NULL, shop TEXT, url TEXT NOT NULL, price TEXT, why TEXT, source_urls TEXT, fetched_at TEXT);
      INSERT INTO ideas (text, status) VALUES ('legacy', 'done');
    `)
    old.close()

    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    expect(listIdeas(db)[0]).toMatchObject({ text: 'legacy', attempts: 0, nextAttemptAt: null })
    db.close()
    // Re-opening is a no-op.
    const again = openDb(dir)
    expect(again.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    again.close()
  })

  it('tolerates a database that already gained the suppliers column', () => {
    const dir = tempDir()
    const old = new Database(path.join(dir, 'wantlist.db'))
    old.exec(`
      CREATE TABLE ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT (datetime('now')), researched_at TEXT, error TEXT);
      CREATE TABLE picks (id INTEGER PRIMARY KEY AUTOINCREMENT, idea_id INTEGER NOT NULL, rank INTEGER NOT NULL, title TEXT NOT NULL, shop TEXT, url TEXT NOT NULL, price TEXT, why TEXT, source_urls TEXT, fetched_at TEXT, suppliers TEXT);
    `)
    old.close()
    const db = openDb(dir)
    expect(db.pragma('user_version', { simple: true })).toBe(SCHEMA_VERSION)
    db.close()
  })
})
