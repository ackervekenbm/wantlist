import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  Availability,
  BoughtPick,
  HuntTarget,
  Idea,
  IdeaList,
  IdeaPatch,
  IdeaStatus,
  ErrorKind,
  NewIdea,
  NewPurchase,
  OfferFacts,
  Pick,
  PickPatch,
  PickSupplier,
  Preferences,
  Purchase,
  Rating,
  ResearchResult,
} from '../types'
import { isCovered } from '../types'
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
  (db) => {
    addColumn(db, 'ideas', 'error_kind', 'TEXT')
    db.exec(`UPDATE ideas SET error_kind = CASE
      WHEN error LIKE 'No product survived%' OR error LIKE 'Nothing new found%' THEN 'nothing-new' ELSE 'stopped' END
      WHERE status = 'error' AND error_kind IS NULL`)
  },
  // 7 - Hunt mode: a target per idea, offers as picks, and what was paid
  (db) => {
    addColumn(db, 'ideas', 'mode', `TEXT NOT NULL DEFAULT 'explore' CHECK (mode IN ('explore','hunt'))`)
    addColumn(db, 'ideas', 'mode_by_owner', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'target', 'TEXT')
    addColumn(db, 'ideas', 'target_by_owner', 'INTEGER NOT NULL DEFAULT 0')
    addColumn(db, 'ideas', 'refill', 'INTEGER')
    addColumn(db, 'picks', 'kind', `TEXT NOT NULL DEFAULT 'pick' CHECK (kind IN ('pick','offer'))`)
    addColumn(db, 'picks', 'offer', 'TEXT')
    db.exec(`
      CREATE TABLE IF NOT EXISTS purchases (
        id INTEGER PRIMARY KEY,
        idea_id INTEGER NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
        at TEXT NOT NULL,
        shop TEXT,
        url TEXT,
        title TEXT NOT NULL,
        packs INTEGER NOT NULL DEFAULT 1,
        units_per_pack REAL,
        unit_label TEXT,
        paid REAL NOT NULL,
        per_unit REAL
      );
      CREATE INDEX IF NOT EXISTS idx_purchases_idea ON purchases(idea_id);
    `)
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
  errorKind: ErrorKind | null
  mode: Idea['mode']
  modeByOwner: number
  target: string | null
  targetByOwner: number
  refill: number | null
}

interface PickRow {
  kind: Pick['kind']
  offer: string | null
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
  fresh_since_round AS freshSinceRound, error_kind AS errorKind,
  mode, mode_by_owner AS modeByOwner, target, target_by_owner AS targetByOwner, refill`

const PURCHASE_COLUMNS = `id, idea_id AS ideaId, at, shop, url, title, packs, units_per_pack AS unitsPerPack,
  unit_label AS unitLabel, paid, per_unit AS perUnit`

const PICK_COLUMNS = `id, idea_id AS ideaId, rank, round, reaction, reason, title, shop, url, price, why, caveat, image, rating,
  source_urls AS sourceUrls, fetched_at AS fetchedAt, suppliers, kind, offer`

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
  const purchases = db.prepare(`SELECT ${PURCHASE_COLUMNS} FROM purchases ORDER BY id DESC`).all() as Purchase[]
  const boughtBy = new Map<number, Purchase[]>()
  for (const p of purchases) {
    const list = boughtBy.get(p.ideaId) ?? []
    list.push({ ...p, at: toIso(p.at) as string })
    boughtBy.set(p.ideaId, list)
  }
  return ideas.map((row) => toIdea(row, byIdea.get(row.id) ?? [], boughtBy.get(row.id) ?? []))
}

export function getIdea(db: WlDb, id: number): Idea | null {
  const row = db.prepare(`SELECT ${IDEA_COLUMNS} FROM ideas WHERE id = ?`).get(id) as
    | IdeaRow
    | undefined
  if (!row) return null
  const picks = db
    .prepare(`SELECT ${PICK_COLUMNS} FROM picks WHERE idea_id = ? ORDER BY round DESC, rank`)
    .all(id) as PickRow[]
  const purchases = db
    .prepare(`SELECT ${PURCHASE_COLUMNS} FROM purchases WHERE idea_id = ? ORDER BY id DESC`)
    .all(id) as Purchase[]
  return toIdea(row, picks.map(toPick), purchases.map((p) => ({ ...p, at: toIso(p.at) as string })))
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
    const steers = reworded || patch.preferences !== undefined || patch.mode !== undefined || patch.target !== undefined
    if (idea.status === 'researching' && steers) {
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
    if (patch.target !== undefined) {
      set('target', patch.target ? JSON.stringify(patch.target) : null)
      set('target_by_owner', patch.target ? 1 : 0)
    }
    if (patch.mode !== undefined) {
      set('mode', patch.mode)
      set('mode_by_owner', 1)
      const kind = patch.mode === 'hunt' ? 'offer' : 'pick'
      if (!idea.picks.some((p) => p.kind === kind)) {
        sets.push(`status = 'queued'`, 'error = NULL', 'error_kind = NULL', 'attempts = 0', 'next_attempt_at = NULL')
        if (patch.list === undefined) set('list', 'wanted')
      }
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
        if (pick.price != null) {
          insertPurchase(db, idea, { title: pick.title, shop: pick.shop, url: pick.url, packs: 1, unitsPerPack: null, paid: pick.price }, now)
        }
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
    `INSERT INTO picks (idea_id, rank, round, title, shop, url, price, why, caveat, image, rating, source_urls, fetched_at, suppliers, kind, offer)
     VALUES (@ideaId, @rank, @round, @title, @shop, @url, @price, @why, @caveat, @image, @rating, @sourceUrls, @fetchedAt, @suppliers, @kind, @offer)`,
  )
  const done = db.prepare(
    `UPDATE ideas SET status = 'done', error = NULL, error_kind = NULL, attempts = 0, next_attempt_at = NULL,
       researched_at = @at, round = @round,
       preferences = CASE WHEN @hunt = 1 THEN preferences ELSE @preferences END,
       preferences_edited = CASE WHEN @hunt = 1 THEN preferences_edited ELSE 0 END,
       title = CASE WHEN title_by_owner = 1 OR @title = '' THEN title ELSE @title END,
       mode = CASE WHEN mode_by_owner = 0 AND @mode IS NOT NULL THEN @mode ELSE mode END,
       target = CASE WHEN target_by_owner = 0 AND @target IS NOT NULL THEN @target ELSE target END,
       refill = COALESCE(refill, @refill)
     WHERE id = @id`,
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
        kind: p.kind ?? 'pick',
        offer: p.offer ? JSON.stringify(p.offer) : null,
      })
    }
    const { brief } = result
    done.run({
      id,
      at: fetchedAt,
      round,
      hunt: brief.mode === 'hunt' ? 1 : 0,
      preferences: JSON.stringify(brief.preferences),
      title: brief.title,
      mode: brief.mode ?? null,
      target: brief.target ? JSON.stringify(brief.target) : null,
      refill: brief.refill == null ? null : brief.refill ? 1 : 0,
    })
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
  kind: ErrorKind | null,
): void {
  db.prepare(
    `UPDATE ideas SET status = ?, error = ?, error_kind = ?, attempts = attempts + 1, next_attempt_at = ?
     WHERE id = ?`,
  ).run(retryAt ? 'queued' : 'error', message, retryAt ? null : kind, retryAt?.toISOString() ?? null, id)
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
      `UPDATE ideas SET status = 'queued', error = NULL, error_kind = NULL, attempts = 0, next_attempt_at = NULL,
         list = 'wanted', bought = NULL WHERE id = ?`,
    ).run(id)
    return 'queued'
  })()
}

const round2 = (n: number) => Math.round(n * 100) / 100

function insertPurchase(
  db: WlDb,
  idea: Idea,
  p: { title: string; shop: string | null; url: string | null; packs: number; unitsPerPack: number | null; paid: number },
  now: Date,
): void {
  const unit = idea.target?.unit ?? null
  const perUnit = unit ? round2(p.paid / (p.packs * (p.unitsPerPack ?? 1))) : null
  db.prepare(
    `INSERT INTO purchases (idea_id, at, shop, url, title, packs, units_per_pack, unit_label, paid, per_unit)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(idea.id, now.toISOString(), p.shop, p.url, p.title, p.packs, p.unitsPerPack, unit, p.paid, perUnit)
}

const QUEUE_NOW = `status = 'queued', error = NULL, error_kind = NULL, attempts = 0, next_attempt_at = NULL, list = 'wanted'`

/**
 * Switches an idea to Hunt (the owner's choice) and queues a run. With a
 * pick, the target is drafted from it; the condition comes from what the
 * idea says. 'busy' while researching, 'bad-pick' for another idea's pick.
 */
export function startHunt(db: WlDb, id: number, pickId: number | null): Idea | null | 'busy' | 'bad-pick' {
  return db.transaction(() => {
    const idea = getIdea(db, id)
    if (!idea) return null
    if (idea.status === 'researching') return 'busy'
    const pick = pickId === null ? null : idea.picks.find((p) => p.id === pickId)
    if (pick === undefined) return 'bad-pick'
    let target: HuntTarget | null = null
    if (pick) {
      const said = [idea.text, idea.notes, ...(idea.preferences?.mustHaves ?? [])].join(' ')
      const condition = /refurb|gereviseerd|reconditionn/i.test(said)
        ? 'refurbished'
        : /\b(tweedehands|occasion|gebruikt|second[- ]hand|used)\b/i.test(said)
          ? 'used'
          : 'new'
      target = { product: pick.title, variant: '', condition, exclude: [], unit: null }
    }
    db.prepare(
      `UPDATE ideas SET mode = 'hunt', mode_by_owner = 1, target = ?, target_by_owner = 0, bought = NULL, ${QUEUE_NOW} WHERE id = ?`,
    ).run(target ? JSON.stringify(target) : null, id)
    return getIdea(db, id)
  })()
}

/**
 * Records what was paid (a pick of this idea, or null for something else),
 * moves the idea to bought and keeps the `bought` snapshot.
 */
export function recordPurchase(db: WlDb, id: number, input: NewPurchase, now = new Date()): Idea | null | 'bad-pick' {
  return db.transaction(() => {
    const idea = getIdea(db, id)
    if (!idea) return null
    const pick = input.pickId === null ? null : idea.picks.find((p) => p.id === input.pickId)
    if (pick === undefined) return 'bad-pick'
    const offer = pick?.offer
    insertPurchase(
      db,
      idea,
      {
        title: pick?.title ?? idea.title ?? idea.text,
        shop: pick?.shop ?? null,
        url: pick?.url ?? null,
        packs: offer?.packs ?? 1,
        unitsPerPack: offer?.unitsPerPack ?? null,
        paid: input.paid,
      },
      now,
    )
    const bought: BoughtPick | null = pick
      ? { title: pick.title, shop: pick.shop, url: pick.url, price: pick.price, at: now.toISOString() }
      : null
    db.prepare(`UPDATE ideas SET list = 'bought', bought = ?, refill = ? WHERE id = ?`).run(
      bought ? JSON.stringify(bought) : null,
      input.refill ? 1 : 0,
      id,
    )
    return getIdea(db, id)
  })()
}

/** A covered idea runs low: back on the wanted list and queued for a new hunt. */
export function runningLow(db: WlDb, id: number): Idea | null | 'not-covered' | 'busy' {
  return db.transaction(() => {
    const idea = getIdea(db, id)
    if (!idea) return null
    if (!isCovered(idea)) return 'not-covered'
    if (idea.status === 'researching') return 'busy'
    db.prepare(`UPDATE ideas SET bought = NULL, ${QUEUE_NOW} WHERE id = ?`).run(id)
    return getIdea(db, id)
  })()
}

/** Removes a purchase; undoing the newest one puts the idea back on the wanted list. */
export function undoPurchase(db: WlDb, purchaseId: number): Idea | null {
  return db.transaction(() => {
    const row = db.prepare('SELECT idea_id AS ideaId FROM purchases WHERE id = ?').get(purchaseId) as
      | { ideaId: number }
      | undefined
    if (!row) return null
    const newest = getIdea(db, row.ideaId)?.purchases[0]?.id === purchaseId
    db.prepare('DELETE FROM purchases WHERE id = ?').run(purchaseId)
    if (newest) db.prepare(`UPDATE ideas SET list = 'wanted', bought = NULL WHERE id = ?`).run(row.ideaId)
    return getIdea(db, row.ideaId)
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

function toIdea(row: IdeaRow, picks: Pick[], purchases: Purchase[]): Idea {
  return {
    ...row,
    modeByOwner: row.modeByOwner === 1,
    target: parseJson<HuntTarget>(row.target),
    targetByOwner: row.targetByOwner === 1,
    refill: row.refill === null ? null : row.refill === 1,
    purchases,
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
    offer: parseJson<OfferFacts>(row.offer),
  }
}

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
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
