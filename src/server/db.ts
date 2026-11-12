import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  Availability,
  BoughtPick,
  Idea,
  IdeaList,
  IdeaPatch,
  IdeaStatus,
  NewIdea,
  Pick,
  PickPatch,
  PickSupplier,
  Preferences,
  Rating,
  ResearchResult,
} from '../types'
import { parsePriceEur } from './research/product'

export type WlDb = Database.Database

export function openDb(dataDir: string): WlDb {
  fs.mkdirSync(dataDir, { recursive: true })
  const db = new Database(path.join(dataDir, 'wantlist.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS ideas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      text TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','researching','done','error')),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      researched_at TEXT,
      error TEXT
    );

    CREATE TABLE IF NOT EXISTS picks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
      rank INTEGER NOT NULL,
      title TEXT NOT NULL,
      shop TEXT,
      url TEXT NOT NULL,
      price TEXT,
      why TEXT,
      source_urls TEXT,
      fetched_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_picks_idea ON picks(idea_id);
    CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
  `)
  migrate(db)
  return db
}

// ---------------------------------------------------------------------------
// Migrations: PRAGMA user_version counts the ones applied. Append only; each
// step must also be safe on a database that predates versioning (the
// suppliers column was added by an unversioned check before).
// ---------------------------------------------------------------------------

const MIGRATIONS: Array<(db: WlDb) => void> = [
  // 1 - every known shop offer per pick
  (db) => addColumn(db, 'picks', 'suppliers', 'TEXT'),
  // 2 - retry bookkeeping for transient failures
  (db) => {
    addColumn(db, 'ideas', 'attempts', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'next_attempt_at', 'TEXT')
  },
  // 3 - research brief per idea; caveat, photo and rating per pick
  (db) => {
    addColumn(db, 'ideas', 'summary', 'TEXT')
    addColumn(db, 'ideas', 'criteria', 'TEXT')
    addColumn(db, 'picks', 'caveat', 'TEXT')
    addColumn(db, 'picks', 'image', 'TEXT')
    addColumn(db, 'picks', 'rating', 'TEXT')
  },
  // 4 - your side of an idea: budget, notes, and which list it sits on
  (db) => {
    addColumn(db, 'ideas', 'budget', 'REAL')
    addColumn(db, 'ideas', 'notes', 'TEXT')
    addColumn(db, 'ideas', 'list', `TEXT NOT NULL DEFAULT 'wanted' CHECK (list IN ('wanted','bought','archived'))`)
    addColumn(db, 'ideas', 'bought', 'TEXT')
  },
  // 5 - rounds, reactions, preferences and card titles
  (db) => {
    addColumn(db, 'picks', 'round', 'INTEGER NOT NULL DEFAULT 1')
    addColumn(db, 'picks', 'reaction', `TEXT CHECK (reaction IN ('no','maybe','yes'))`)
    addColumn(db, 'picks', 'reason', 'TEXT')
    addColumn(db, 'ideas', 'round', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'preferences', 'TEXT')
    addColumn(db, 'ideas', 'preferences_edited', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'title', 'TEXT')
    addColumn(db, 'ideas', 'title_by_owner', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'fresh_since_round', 'INTEGER')
    const withPicks = 'EXISTS (SELECT 1 FROM picks WHERE idea_id = ideas.id)'
    db.exec(`UPDATE ideas SET round = 1 WHERE ${withPicks}`)
    const rows = db
      .prepare(`SELECT id, summary, criteria FROM ideas WHERE ${withPicks}`)
      .all() as Array<{ id: number; summary: string | null; criteria: string | null }>
    const set = db.prepare('UPDATE ideas SET preferences = ? WHERE id = ?')
    for (const r of rows) {
      const prefs: Preferences = { summary: r.summary ?? '', mustHaves: parseStrings(r.criteria), avoid: [], likes: [] }
      set.run(JSON.stringify(prefs), r.id)
    }
  },
]

export const SCHEMA_VERSION = MIGRATIONS.length

function migrate(db: WlDb): void {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v += 1) {
    db.transaction(() => {
      MIGRATIONS[v](db)
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
}

function addColumn(db: WlDb, table: string, column: string, type: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  if (!rows.some((r) => r.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
  }
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

interface IdeaRow {
  id: number
  text: string
  budget: number | null
  notes: string | null
  list: IdeaList
  bought: string | null
  status: IdeaStatus
  createdAt: string
  researchedAt: string | null
  error: string | null
  attempts: number
  nextAttemptAt: string | null
  title: string | null
  titleByOwner: number
  round: number
  preferences: string | null
  preferencesEdited: number
  freshSinceRound: number | null
}

interface PickRow {
  id: number
  ideaId: number
  rank: number
  round: number
  reaction: Pick['reaction']
  reason: string | null
  title: string
  shop: string | null
  url: string
  price: string | number | null
  why: string | null
  caveat: string | null
  image: string | null
  rating: string | null
  sourceUrls: string | null
  fetchedAt: string | null
  suppliers: string | null
}

const IDEA_COLUMNS = `id, text, budget, notes, list, bought, status, created_at AS createdAt, researched_at AS researchedAt,
  error, attempts, next_attempt_at AS nextAttemptAt,
  title, title_by_owner AS titleByOwner, round, preferences, preferences_edited AS preferencesEdited,
  fresh_since_round AS freshSinceRound`

const PICK_COLUMNS = `id, idea_id AS ideaId, rank, round, reaction, reason, title, shop, url, price, why, caveat, image, rating,
  source_urls AS sourceUrls, fetched_at AS fetchedAt, suppliers`

/** Newest first, with picks, in two queries. */
export function listIdeas(db: WlDb): Idea[] {
  const ideas = db.prepare(`SELECT ${IDEA_COLUMNS} FROM ideas ORDER BY id DESC`).all() as IdeaRow[]
  const picks = db.prepare(`SELECT ${PICK_COLUMNS} FROM picks ORDER BY idea_id, round DESC, rank`).all() as PickRow[]
  const byIdea = new Map<number, Pick[]>()
  for (const row of picks) {
    const list = byIdea.get(row.ideaId) ?? []
    list.push(toPick(row))
    byIdea.set(row.ideaId, list)
  }
  return ideas.map((row) => toIdea(row, byIdea.get(row.id) ?? []))
}

export function getIdea(db: WlDb, id: number): Idea | null {
  const row = db.prepare(`SELECT ${IDEA_COLUMNS} FROM ideas WHERE id = ?`).get(id) as
    | IdeaRow
    | undefined
  if (!row) return null
  const picks = db
    .prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE idea_id = ? ORDER BY round DESC, rank`)
    .all(id) as PickRow[]
  return toIdea(row, picks.map(toPick))
}

/** Wanted ideas waiting for the worker, scheduled retries included. */
export function countQueued(db: WlDb): number {
  return (
    db.prepare(`SELECT COUNT(*) AS n FROM ideas WHERE status = 'queued' AND list = 'wanted'`).get() as {
      n: number
    }
  ).n
}

/**
 * Queued ideas whose retry (if any) is due at `now`, oldest first. Only the
 * wanted list is researched: bought and archived ideas keep their place in
 * the queue but wait until they are wanted again.
 */
export function dueIdeaIds(db: WlDb, cap: number, now: Date): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM ideas
       WHERE status = 'queued' AND list = 'wanted' AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
       ORDER BY id ASC LIMIT ?`,
    )
    .all(now.toISOString(), cap) as Array<{ id: number }>
  return rows.map((r) => r.id)
}

/** The earliest scheduled retry still in the future, or null. */
export function nextScheduledAttempt(db: WlDb, now: Date): Date | null {
  const row = db
    .prepare(
      `SELECT MIN(next_attempt_at) AS at FROM ideas
       WHERE status = 'queued' AND list = 'wanted' AND next_attempt_at > ?`,
    )
    .get(now.toISOString()) as { at: string | null }
  return row.at ? new Date(row.at) : null
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export function createIdea(db: WlDb, idea: string | NewIdea): number {
  const { text, budget = null, notes = null } = typeof idea === 'string' ? { text: idea } : idea
  const info = db
    .prepare('INSERT INTO ideas (text, budget, notes) VALUES (?, ?, ?)')
    .run(text.trim(), budget, notes?.trim() || null)
  return Number(info.lastInsertRowid)
}

export class PatchError extends Error {}

/** The idea is being researched, so an edit that restarts or steers research must wait. */
export class BusyError extends Error {}

/**
 * Applies an edit (already validated for shape by the API). Moving to
 * 'bought' snapshots the chosen pick, which must belong to this idea
 * (`boughtPickId: null` = bought something else, no snapshot); moving
 * anywhere else clears the snapshot. Returns null for an unknown idea.
 */
export function updateIdea(db: WlDb, id: number, patch: IdeaPatch, now = new Date()): Idea | null {
  return db.transaction(() => {
    const idea = getIdea(db, id)
    if (!idea) return null
    const sets: string[] = []
    const values: unknown[] = []
    const set = (column: string, value: unknown) => {
      sets.push(`${column} = ?`)
      values.push(value)
    }
    const text = patch.text?.trim()
    const reworded = text !== undefined && text !== idea.text.trim()
    if (idea.status === 'researching' && (reworded || patch.preferences !== undefined)) {
      throw new BusyError('this idea is being researched right now')
    }
    if (text !== undefined) set('text', text)
    if (reworded) {
      set('preferences', null)
      set('preferences_edited', 0)
      set('fresh_since_round', idea.round)
    }
    // After the text, so the owner's preferences win over the reset above.
    if (patch.preferences !== undefined) {
      sets.push('preferences = ?', 'preferences_edited = 1')
      values.push(JSON.stringify(patch.preferences))
    }
    if (patch.title !== undefined) {
      set('title', patch.title)
      set('title_by_owner', patch.title === null ? 0 : 1)
    }
    if (patch.budget !== undefined) set('budget', patch.budget)
    if (patch.notes !== undefined) set('notes', patch.notes?.trim() || null)
    if (patch.list !== undefined) {
      set('list', patch.list)
      let bought: BoughtPick | null = null
      if (patch.list === 'bought' && patch.boughtPickId != null) {
        const pick = idea.picks.find((p) => p.id === patch.boughtPickId)
        if (!pick) throw new PatchError('that pick does not belong to this idea')
        bought = { title: pick.title, shop: pick.shop, url: pick.url, price: pick.price, at: now.toISOString() }
      } else if (patch.list === 'bought' && patch.boughtPickId === undefined) {
        // Moving to bought without naming a pick keeps an earlier snapshot.
        bought = idea.bought
      }
      set('bought', bought ? JSON.stringify(bought) : null)
    }
    if (sets.length > 0) {
      db.prepare(`UPDATE ideas SET ${sets.join(', ')} WHERE id = ?`).run(...values, id)
    }
    return getIdea(db, id)
  })()
}

/** Deletes an idea and its picks; false when it did not exist. */
export function deleteIdea(db: WlDb, id: number): boolean {
  return db.prepare('DELETE FROM ideas WHERE id = ?').run(id).changes > 0
}

/**
 * Moves a queued idea to `researching`. False when it is no longer queued
 * (deleted, or claimed by another run), so the caller skips it.
 */
export function claimIdea(db: WlDb, id: number): boolean {
  return (
    db.prepare(`UPDATE ideas SET status = 'researching' WHERE id = ? AND status = 'queued'`).run(id)
      .changes > 0
  )
}

/**
 * Adds a round of picks (earlier rounds stay) and the brief, and marks the idea done, atomically. False
 * when the idea was deleted while it was being researched.
 */
export function completeIdea(db: WlDb, id: number, result: ResearchResult, now = new Date()): boolean {
  const roundOf = db.prepare('SELECT round FROM ideas WHERE id = ?')
  const ins = db.prepare(
    `INSERT INTO picks (idea_id, rank, round, title, shop, url, price, why, caveat, image, rating, source_urls, fetched_at, suppliers)
     VALUES (@ideaId, @rank, @round, @title, @shop, @url, @price, @why, @caveat, @image, @rating, @sourceUrls, @fetchedAt, @suppliers)`,
  )
  const done = db.prepare(
    `UPDATE ideas SET status = 'done', error = NULL, attempts = 0, next_attempt_at = NULL,
       researched_at = ?, round = ?, preferences = ?, preferences_edited = 0,
       title = CASE WHEN title_by_owner = 1 OR ? = '' THEN title ELSE ? END
     WHERE id = ?`,
  )
  const fetchedAt = now.toISOString()
  return db.transaction(() => {
    const row = roundOf.get(id) as { round: number } | undefined
    if (!row) return false
    const round = row.round + 1
    for (const p of result.picks) {
      ins.run({
        ideaId: id,
        rank: p.rank,
        round,
        title: p.title,
        shop: p.shop,
        url: p.url,
        price: p.price,
        why: p.why,
        caveat: p.caveat,
        image: p.image,
        rating: p.rating ? JSON.stringify(p.rating) : null,
        sourceUrls: JSON.stringify(p.sourceUrls),
        fetchedAt,
        suppliers: JSON.stringify(p.suppliers),
      })
    }
    const { title } = result.brief
    done.run(fetchedAt, round, JSON.stringify(result.brief.preferences), title, title, id)
    return true
  })()
}

/**
 * Records a failed attempt. With `retryAt` the idea goes back to the queue
 * until then; without it, it stops at `error` until a manual re-run. Earlier
 * picks are kept either way, so a failed refresh never loses results.
 */
export function failIdea(
  db: WlDb,
  id: number,
  message: string,
  retryAt: Date | null,
): void {
  db.prepare(
    `UPDATE ideas SET status = ?, error = ?, attempts = attempts + 1, next_attempt_at = ?
     WHERE id = ?`,
  ).run(retryAt ? 'queued' : 'error', message, retryAt?.toISOString() ?? null, id)
}

/**
 * Back to the queue now, with a clean retry budget, and back on the wanted
 * list (researching it again means you want it). Current picks stay visible
 * until the new round adds its own. 'busy' while researching; with
 * `requireSignal`, 'nothing' when no pick has a reaction and the preferences
 * were not edited (a refine has nothing to learn from). Null: unknown idea.
 */
export function requeueIdea(
  db: WlDb,
  id: number,
  opts: { requireSignal: boolean },
): 'queued' | 'busy' | 'nothing' | null {
  return db.transaction(() => {
    const idea = getIdea(db, id)
    if (!idea) return null
    if (idea.status === 'researching') return 'busy'
    if (opts.requireSignal && !idea.preferencesEdited && !idea.picks.some((p) => p.reaction)) return 'nothing'
    db.prepare(
      `UPDATE ideas SET status = 'queued', error = NULL, attempts = 0, next_attempt_at = NULL,
         list = 'wanted', bought = NULL WHERE id = ?`,
    ).run(id)
    return 'queued'
  })()
}

/** Saves, changes or clears the owner's reaction to a pick. Null: unknown pick. */
export function reactToPick(db: WlDb, pickId: number, patch: PickPatch): Idea | null {
  return db.transaction(() => {
    const row = db.prepare('SELECT idea_id AS ideaId FROM picks WHERE id = ?').get(pickId) as
      | { ideaId: number }
      | undefined
    if (!row) return null
    if (patch.reaction !== undefined) {
      db.prepare('UPDATE picks SET reaction = ? WHERE id = ?').run(patch.reaction, pickId)
      // A why-not belongs to No way: switching to Kind of / Yes without a new one drops it.
      if (patch.reaction === null || (patch.reaction !== 'no' && patch.reason === undefined))
        db.prepare('UPDATE picks SET reason = NULL WHERE id = ?').run(pickId)
    }
    if (patch.reason !== undefined && patch.reaction !== null) {
      db.prepare('UPDATE picks SET reason = ? WHERE id = ?').run(patch.reason?.trim() || null, pickId)
    }
    return getIdea(db, row.ideaId)
  })()
}

/**
 * After a crash or restart nothing is researching: anything left in that
 * state was interrupted, so it goes back to the queue.
 */
export function recoverInterrupted(db: WlDb): number {
  return db.prepare(`UPDATE ideas SET status = 'queued' WHERE status = 'researching'`).run().changes
}

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

function toIdea(row: IdeaRow, picks: Pick[]): Idea {
  return {
    ...row,
    createdAt: toIso(row.createdAt) as string,
    researchedAt: toIso(row.researchedAt),
    titleByOwner: row.titleByOwner === 1,
    preferences: parsePreferences(row.preferences),
    preferencesEdited: row.preferencesEdited === 1,
    bought: parseBought(row.bought),
    picks,
  }
}

function toPick(row: PickRow): Pick {
  return {
    ...row,
    price: parsePriceEur(row.price),
    rating: parseRating(row.rating),
    sourceUrls: parseStrings(row.sourceUrls),
    suppliers: parseSuppliers(row.suppliers),
  }
}

/** SQLite's datetime('now') is UTC without a zone ("2026-11-07 13:37:09"). */
function toIso(value: string | null): string | null {
  if (!value) return null
  return value.includes('T') ? value : `${value.replace(' ', 'T')}Z`
}

function parseStrings(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

const AVAILABILITY = new Set<unknown>(['in_stock', 'out_of_stock', 'preorder', 'unknown'])

function parseBought(raw: string | null): BoughtPick | null {
  if (!raw) return null
  try {
    const b = JSON.parse(raw) as Partial<BoughtPick>
    if (typeof b?.title !== 'string' || typeof b.url !== 'string') return null
    return {
      title: b.title,
      shop: typeof b.shop === 'string' ? b.shop : null,
      url: b.url,
      price: typeof b.price === 'number' ? b.price : null,
      at: typeof b.at === 'string' ? b.at : '',
    }
  } catch {
    return null
  }
}

function parsePreferences(raw: string | null): Preferences | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as Partial<Preferences>
    if (!p || typeof p !== 'object') return null
    const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      summary: typeof p.summary === 'string' ? p.summary : '',
      mustHaves: list(p.mustHaves),
      avoid: list(p.avoid),
      likes: list(p.likes),
    }
  } catch {
    return null
  }
}

function parseRating(raw: string | null): Rating | null {
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as Partial<Rating>
    return typeof r?.value === 'number' ? { value: r.value, count: typeof r.count === 'number' ? r.count : null } : null
  } catch {
    return null
  }
}

function parseSuppliers(raw: string | null): PickSupplier[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Rows from before verified offers carry the price as text and no stock.
    return parsed
      .filter((s) => !!s && typeof s.shop === 'string' && typeof s.url === 'string')
      .map((s) => ({
        shop: s.shop,
        url: s.url,
        price: parsePriceEur(s.price),
        availability: AVAILABILITY.has(s.availability) ? (s.availability as Availability) : 'unknown',
        checked: s.checked === true,
      }))
  } catch {
    return []
  }
}
