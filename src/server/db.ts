import fs from 'node:fs'
import path from 'node:path'
import Database from 'better-sqlite3'
import type {
  Idea,
  IdeaStatus,
  Pick,
  WorkerRuntime,
} from '../types'

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
  return db
}

export function createIdea(db: WlDb, text: string): number {
  const info = db.prepare('INSERT INTO ideas (text) VALUES (?)').run(text.trim())
  return Number(info.lastInsertRowid)
}

export function listIdeas(db: WlDb): Idea[] {
  const rows = db
    .prepare(`SELECT id FROM ideas ORDER BY id DESC`)
    .all() as Array<{ id: number }>
  return rows.map((r) => getIdea(db, r.id) as Idea)
}

export function getIdea(db: WlDb, id: number): Idea | null {
  const idea = db
    .prepare(
      `SELECT id, text, status, created_at AS createdAt, researched_at AS researchedAt, error
       FROM ideas WHERE id = ?`,
    )
    .get(id) as PickIdeaRow | undefined
  if (!idea) return null
  const picks = db
    .prepare(
      `SELECT id, idea_id AS ideaId, rank, title, shop, url, price, why,
              source_urls AS sourceUrls, fetched_at AS fetchedAt
       FROM picks WHERE idea_id = ? ORDER BY rank ASC`,
    )
    .all(id) as PickRow[]
  return {
    ...idea,
    picks: picks.map((p) => ({
      ...p,
      sourceUrls: parseSourceUrls(p.sourceUrls),
    })),
  }
}

interface PickIdeaRow {
  id: number
  text: string
  status: IdeaStatus
  createdAt: string
  researchedAt: string | null
  error: string | null
}

interface PickRow {
  id: number
  ideaId: number
  rank: number
  title: string
  shop: string | null
  url: string
  price: string | null
  why: string | null
  sourceUrls: string
  fetchedAt: string | null
}

function parseSourceUrls(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export function setIdeaStatus(
  db: WlDb,
  id: number,
  status: IdeaStatus,
  error: string | null = null,
): void {
  db.prepare(
    `UPDATE ideas SET status = ?, error = ?, researched_at = CASE WHEN ? THEN datetime('now') ELSE researched_at END WHERE id = ?`,
  ).run(status, error, status === 'done' ? 1 : 0, id)
}

export function requeueIdea(db: WlDb, id: number): void {
  db.prepare(
    `UPDATE ideas SET status = 'queued', error = NULL WHERE id = ? AND status IN ('done','error')`,
  ).run(id)
  db.prepare('DELETE FROM picks WHERE idea_id = ?').run(id)
}

export function replacePicks(db: WlDb, ideaId: number, picks: Pick[]): void {
  const del = db.prepare('DELETE FROM picks WHERE idea_id = ?')
  const ins = db.prepare(
    `INSERT INTO picks (idea_id, rank, title, shop, url, price, why, source_urls, fetched_at)
     VALUES (@ideaId, @rank, @title, @shop, @url, @price, @why, @sourceUrls, @fetchedAt)`,
  )
  const tx = db.transaction(() => {
    del.run(ideaId)
    for (const p of picks) {
      ins.run({
        ideaId,
        rank: p.rank,
        title: p.title,
        shop: p.shop,
        url: p.url,
        price: p.price,
        why: p.why,
        sourceUrls: JSON.stringify(p.sourceUrls ?? []),
        fetchedAt: p.fetchedAt ?? new Date().toISOString(),
      })
    }
  })
  tx()
}

export function deleteIdea(db: WlDb, id: number): void {
  db.prepare('DELETE FROM ideas WHERE id = ?').run(id)
}

export function queuedIdeaIds(db: WlDb, cap: number): number[] {
  const rows = db
    .prepare(
      `SELECT id FROM ideas WHERE status IN ('queued','error') ORDER BY id ASC LIMIT ?`,
    )
    .all(cap) as Array<{ id: number }>
  return rows.map((r) => r.id)
}

export function makeWorkerRuntime(db: WlDb): WorkerRuntime {
  const queued = db
    .prepare(`SELECT COUNT(*) AS n FROM ideas WHERE status IN ('queued','error')`)
    .get() as { n: number }
  return {
    running: false,
    lastRunAt: null,
    lastRunResult: null,
    queuedCount: queued.n,
  }
}