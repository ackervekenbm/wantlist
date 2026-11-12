import path from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  BusyError,
  PatchError,
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
  reactToPick,
  recoverInterrupted,
  requeueIdea,
  updateIdea,
} from '../src/server/db'
import { finalPicks, researchResult, tempDb, tempDir } from './helpers'

const NO_SIGNAL = { requireSignal: false }
const PREFS = { summary: 's', mustHaves: ['quiet'], avoid: [], likes: [] }

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

    expect(completeIdea(db, id, researchResult(), new Date('2026-11-01T10:00:00Z'))).toBe(true)
    const idea = getIdea(db, id)!
    expect(idea).toMatchObject({ status: 'done', error: null, researchedAt: '2026-11-01T10:00:00.000Z' })
    expect(idea.picks.map((p) => p.title)).toEqual(['A fan', 'A second fan'])
    expect(idea.preferences).toEqual({
      summary: 'A quiet fan for indoor cycling',
      mustHaves: ['quiet', 'strong airflow'],
      avoid: [],
      likes: [],
    })
    expect(idea.picks[0]).toMatchObject({
      price: 89,
      caveat: 'Loud at full speed',
      image: 'https://shop.be/fan.jpg',
      rating: { value: 4.5, count: 120 },
      sourceUrls: ['https://shop.be/fan'],
      fetchedAt: '2026-11-01T10:00:00.000Z',
    })
    expect(idea.picks[0].suppliers).toEqual(finalPicks()[0].suppliers)
    expect(idea.picks[1]).toMatchObject({ price: null, caveat: null, image: null, rating: null })
  })

  it('lists picks with their own idea', () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    completeIdea(db, a, researchResult())
    completeIdea(db, b, researchResult(finalPicks().slice(0, 1)))
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
    expect(completeIdea(db, id, researchResult())).toBe(false)
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
    completeIdea(db, id, researchResult())
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
    completeIdea(db, id, researchResult())
    requeueIdea(db, id, NO_SIGNAL)
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
    completeIdea(db, id, researchResult())
    expect(getIdea(db, id)).toMatchObject({ status: 'done', error: null, attempts: 0, nextAttemptAt: null })
  })

  it('manual re-run requeues now with a clean budget, but not mid-research', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'jacket')
    claimIdea(db, id)
    expect(requeueIdea(db, id, NO_SIGNAL)).toBe('busy')
    failIdea(db, id, 'boom', null)
    expect(requeueIdea(db, id, NO_SIGNAL)).toBe('queued')
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

describe('lists', () => {
  const now = new Date('2026-11-07T12:00:00Z')

  it('stores budget and notes, and starts on the wanted list', () => {
    const { db } = tempDb()
    const id = createIdea(db, { text: 'shoes', budget: 120, notes: ' wide ' })
    expect(getIdea(db, id)).toMatchObject({ budget: 120, notes: 'wide', list: 'wanted', bought: null })
  })

  it('researches only the wanted list', () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    updateIdea(db, b, { list: 'archived' })
    expect(dueIdeaIds(db, 10, now)).toEqual([a])
    expect(countQueued(db)).toBe(1)
    updateIdea(db, b, { list: 'wanted' })
    expect(dueIdeaIds(db, 10, now)).toEqual([a, b])
  })

  it('re-researching a bought idea puts it back on the wanted list', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'a')
    completeIdea(db, id, researchResult())
    updateIdea(db, id, { list: 'bought', boughtPickId: getIdea(db, id)!.picks[0].id })
    requeueIdea(db, id, NO_SIGNAL)
    expect(getIdea(db, id)).toMatchObject({ list: 'wanted', bought: null, status: 'queued' })
  })

  it('rejects a bought pick from another idea and leaves the idea untouched', () => {
    const { db } = tempDb()
    const a = createIdea(db, 'a')
    const b = createIdea(db, 'b')
    completeIdea(db, b, researchResult())
    const foreign = getIdea(db, b)!.picks[0].id
    expect(() => updateIdea(db, a, { list: 'bought', boughtPickId: foreign, notes: 'x' })).toThrow(PatchError)
    expect(getIdea(db, a)).toMatchObject({ list: 'wanted', notes: null })
  })

  it('returns null for an unknown idea', () => {
    const { db } = tempDb()
    expect(updateIdea(db, 42, { list: 'archived' })).toBeNull()
  })
})

describe('rounds and reactions', () => {
  const twoRounds = () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    completeIdea(db, id, researchResult())
    completeIdea(db, id, researchResult())
    return { db, id }
  }

  it('accumulates rounds: a second completion adds round 2 and keeps round 1', () => {
    const { db, id } = twoRounds()
    const idea = getIdea(db, id)!
    expect(idea.round).toBe(2)
    expect(idea.picks.map((p) => p.round)).toEqual([2, 2, 1, 1])
    expect(listIdeas(db)[0].picks.map((p) => p.round)).toEqual([2, 2, 1, 1])
  })

  it('stores the brief as title and preferences, and keeps an owner title', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    completeIdea(db, id, { ...researchResult(), brief: { title: 'Quiet fan', preferences: PREFS } })
    expect(getIdea(db, id)).toMatchObject({ title: 'Quiet fan', preferences: PREFS })
    updateIdea(db, id, { title: 'Mine' })
    completeIdea(db, id, { ...researchResult(), brief: { title: 'Other', preferences: PREFS } })
    expect(getIdea(db, id)).toMatchObject({ title: 'Mine', titleByOwner: true })
    updateIdea(db, id, { title: null })
    expect(getIdea(db, id)).toMatchObject({ title: null, titleByOwner: false })
  })

  it('an empty model title keeps the old one', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'fan')
    completeIdea(db, id, researchResult())
    completeIdea(db, id, { ...researchResult(), brief: { title: '', preferences: PREFS } })
    expect(getIdea(db, id)?.title).toBe('Quiet fan')
  })

  it('saves, changes and clears reactions with a trimmed reason', () => {
    const { db, id } = twoRounds()
    const pickId = getIdea(db, id)!.picks[0].id
    const pick = () => getIdea(db, id)!.picks.find((p) => p.id === pickId)!
    reactToPick(db, pickId, { reaction: 'no', reason: '  too fluffy ' })
    expect(pick()).toMatchObject({ reaction: 'no', reason: 'too fluffy' })
    reactToPick(db, pickId, { reason: '   ' })
    expect(pick().reason).toBeNull()
    reactToPick(db, pickId, { reaction: 'maybe', reason: 'x' })
    reactToPick(db, pickId, { reaction: null })
    expect(pick()).toMatchObject({ reaction: null, reason: null })
    expect(reactToPick(db, 9999, { reaction: 'yes' })).toBeNull()
  })

  it('no + reason then yes clears the reason; yes with an explicit reason keeps it', () => {
    const { db, id } = twoRounds()
    const pickId = getIdea(db, id)!.picks[0].id
    const pick = () => getIdea(db, id)!.picks.find((p) => p.id === pickId)!
    reactToPick(db, pickId, { reaction: 'no', reason: 'too fluffy' })
    reactToPick(db, pickId, { reaction: 'yes' })
    expect(pick()).toMatchObject({ reaction: 'yes', reason: null })
    reactToPick(db, pickId, { reaction: 'maybe', reason: 'pricey' })
    expect(pick()).toMatchObject({ reaction: 'maybe', reason: 'pricey' })
  })

  it('a reworded idea clears preferences and marks a fresh start; same text does not', () => {
    const { db, id } = twoRounds()
    const before = getIdea(db, id)!
    updateIdea(db, id, { text: `  ${before.text} ` })
    expect(getIdea(db, id)).toMatchObject({ preferences: before.preferences, freshSinceRound: null })
    updateIdea(db, id, { text: 'winter boots' })
    expect(getIdea(db, id)).toMatchObject({ preferences: null, preferencesEdited: false, freshSinceRound: 2 })
  })

  it('refuses a preferences edit or a reworded idea mid-research, but not a budget edit', () => {
    const { db, id } = twoRounds()
    expect(updateIdea(db, id, { preferences: PREFS })?.preferencesEdited).toBe(true)
    requeueIdea(db, id, NO_SIGNAL)
    claimIdea(db, id)
    expect(() => updateIdea(db, id, { preferences: PREFS })).toThrow(BusyError)
    expect(() => updateIdea(db, id, { text: 'other' })).toThrow(BusyError)
    expect(updateIdea(db, id, { budget: 50 })?.budget).toBe(50)
  })

  it('budget and notes edits keep the preferences', () => {
    const { db, id } = twoRounds()
    const before = getIdea(db, id)!.preferences
    updateIdea(db, id, { budget: 10, notes: 'n' })
    expect(getIdea(db, id)).toMatchObject({ preferences: before, freshSinceRound: null })
  })

  it('a failed round keeps every earlier round', () => {
    const { db, id } = twoRounds()
    claimIdea(db, id)
    failIdea(db, id, 'boom', null)
    expect(getIdea(db, id)!.picks.map((p) => p.round)).toEqual([2, 2, 1, 1])
    expect(getIdea(db, id)!.round).toBe(2)
  })

  it('a text and preferences patch together leaves the owner preferences in place', () => {
    const { db, id } = twoRounds()
    updateIdea(db, id, { text: 'winter boots', preferences: PREFS })
    expect(getIdea(db, id)).toMatchObject({ text: 'winter boots', preferences: PREFS, preferencesEdited: true, freshSinceRound: 2 })
  })

  it('requeue requires a signal only when asked', () => {
    const { db, id } = twoRounds()
    expect(requeueIdea(db, id, { requireSignal: true })).toBe('nothing')
    expect(requeueIdea(db, id, { requireSignal: false })).toBe('queued')
    reactToPick(db, getIdea(db, id)!.picks[3].id, { reaction: 'yes' })
    expect(requeueIdea(db, id, { requireSignal: true })).toBe('queued')
    claimIdea(db, id)
    expect(requeueIdea(db, id, { requireSignal: true })).toBe('busy')
    expect(requeueIdea(db, 999, { requireSignal: true })).toBeNull()
  })
})

describe('migrations', () => {
  it('migration 5 makes existing picks round 1 and moves the brief into preferences', () => {
    const dir = tempDir()
    const old = new Database(path.join(dir, 'wantlist.db'))
    old.exec(`
      CREATE TABLE ideas (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', created_at TEXT NOT NULL DEFAULT (datetime('now')), researched_at TEXT, error TEXT, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT, summary TEXT, criteria TEXT, budget REAL, notes TEXT, list TEXT NOT NULL DEFAULT 'wanted', bought TEXT);
      CREATE TABLE picks (id INTEGER PRIMARY KEY AUTOINCREMENT, idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE, rank INTEGER NOT NULL, title TEXT NOT NULL, shop TEXT, url TEXT NOT NULL, price TEXT, why TEXT, source_urls TEXT, fetched_at TEXT, suppliers TEXT, caveat TEXT, image TEXT, rating TEXT);
      INSERT INTO ideas (text, status, summary, criteria) VALUES ('with brief', 'done', 'S', '["a","b"]');
      INSERT INTO ideas (text, status) VALUES ('no brief', 'done');
      INSERT INTO ideas (text) VALUES ('no picks');
      INSERT INTO picks (idea_id, rank, title, url) VALUES (1, 1, 'P1', 'https://a.be'), (1, 2, 'P2', 'https://b.be'), (2, 1, 'P3', 'https://c.be');
      PRAGMA user_version = 4;
    `)
    old.close()

    const db = openDb(dir)
    const byText = new Map(listIdeas(db).map((i) => [i.text, i]))
    const withBrief = byText.get('with brief')!
    expect(withBrief).toMatchObject({
      round: 1,
      title: null,
      preferences: { summary: 'S', mustHaves: ['a', 'b'], avoid: [], likes: [] },
    })
    expect(withBrief.picks.every((p) => p.round === 1 && p.reaction === null)).toBe(true)
    expect(byText.get('no brief')).toMatchObject({
      round: 1,
      preferences: { summary: '', mustHaves: [], avoid: [], likes: [] },
    })
    expect(byText.get('no picks')).toMatchObject({ round: 0, preferences: null })
    db.close()
  })

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

  it('reads picks stored before verified offers (text prices, no stock)', () => {
    const { db } = tempDb()
    const id = createIdea(db, 'old')
    db.prepare(
      `INSERT INTO picks (idea_id, rank, title, shop, url, price, suppliers) VALUES (?, 1, 'Fan', 'S', 'https://s.be/f', '1.299,00', ?)`,
    ).run(id, JSON.stringify([{ shop: 'S', url: 'https://s.be/f', price: '€ 1.299,00' }, { shop: 'T', url: 'https://t.be/f', price: null }]))
    const pick = listIdeas(db)[0].picks[0]
    expect(pick.price).toBe(1299)
    expect(pick.suppliers).toEqual([
      { shop: 'S', url: 'https://s.be/f', price: 1299, availability: 'unknown', checked: false },
      { shop: 'T', url: 'https://t.be/f', price: null, availability: 'unknown', checked: false },
    ])
    expect(pick).toMatchObject({ caveat: null, image: null, rating: null, sourceUrls: [] })
    expect(listIdeas(db)[0]).toMatchObject({ preferences: null, round: 0, title: null })
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
