import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { openDb, type WlDb } from '../src/server/db'
import type { FinalPick, ResearchResult } from '../src/types'

const cleanups: Array<() => void> = []

afterEach(() => {
  while (cleanups.length) cleanups.pop()?.()
})

/** A fresh database in a temp dir, closed and removed after the test. */
export function tempDb(): { db: WlDb; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wantlist-test-'))
  const db = openDb(dir)
  cleanups.push(() => {
    if (db.open) db.close()
    fs.rmSync(dir, { recursive: true, force: true })
  })
  return { db, dir }
}

export function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wantlist-test-'))
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

export function finalPicks(): FinalPick[] {
  return [
    {
      rank: 1,
      title: 'A fan',
      shop: 'Shop Be',
      url: 'https://shop.be/fan',
      price: 89,
      why: 'quiet at low rpm',
      caveat: 'Loud at full speed',
      image: 'https://shop.be/fan.jpg',
      rating: { value: 4.5, count: 120 },
      sourceUrls: ['https://shop.be/fan'],
      suppliers: [
        { shop: 'Shop Be', url: 'https://shop.be/fan', price: 89, availability: 'in_stock', checked: true },
        { shop: 'Alt Shop', url: 'https://alt.eu/fan', price: 99, availability: 'unknown', checked: false },
      ],
    },
    {
      rank: 2,
      title: 'A second fan',
      shop: 'Other Shop',
      url: 'https://other.eu/fan2',
      price: null,
      why: 'cheap',
      caveat: null,
      image: null,
      rating: null,
      sourceUrls: [],
      suppliers: [{ shop: 'Other Shop', url: 'https://other.eu/fan2', price: null, availability: 'unknown', checked: false }],
    },
  ]
}

export function researchResult(picks: FinalPick[] = finalPicks()): ResearchResult {
  return {
    brief: {
      title: 'Quiet fan',
      preferences: { summary: 'A quiet fan for indoor cycling', mustHaves: ['quiet', 'strong airflow'], avoid: [], likes: [] },
    },
    picks,
  }
}
