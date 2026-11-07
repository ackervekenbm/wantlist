import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach } from 'vitest'
import { openDb, type WlDb } from '../src/server/db'
import type { FinalPick } from '../src/types'

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
      price: '89',
      why: 'quiet at low rpm',
      suppliers: [
        { shop: 'Shop Be', url: 'https://shop.be/fan', price: '89' },
        { shop: 'Alt Shop', url: 'https://alt.eu/fan', price: '99' },
      ],
    },
    {
      rank: 2,
      title: 'A second fan',
      shop: 'Other Shop',
      url: 'https://other.eu/fan2',
      price: null,
      why: 'cheap',
      suppliers: [{ shop: 'Other Shop', url: 'https://other.eu/fan2', price: null }],
    },
  ]
}
