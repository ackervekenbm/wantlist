import { describe, expect, it } from 'vitest'
import { ResearchError } from './errors'
import {
  HUNT_PLAN_SYSTEM,
  OFFER_SYSTEM,
  SELECT_SYSTEM,
  normalizeHuntPlan,
  normalizeOffers,
  normalizeSelect,
} from './huntPrompts'
import { SHOP_RULES } from './prompts'
import type { HuntTarget } from '../../types'

const current: HuntTarget = { product: 'Feliway Classic', variant: '48 ml', condition: 'new', exclude: [], unit: null }

describe('normalizeHuntPlan', () => {
  it('throws invalid without queries', () => {
    try {
      normalizeHuntPlan({ target: { product: 'x' }, searchQueries: [] }, null, false)
      expect.unreachable()
    } catch (e) {
      expect((e as ResearchError).kind).toBe('invalid')
    }
  })

  it('caps queries at 4 and cleans the target', () => {
    const r = normalizeHuntPlan(
      { title: 'T', target: { product: ' Fan ', variant: ' ', condition: 'weird' }, searchQueries: ['a', 'b', 'c', 'd', 'e'], refill: true },
      null,
      false,
    )
    expect(r.searchQueries).toHaveLength(4)
    expect(r.target).toEqual({ product: 'Fan', variant: '', condition: 'new', exclude: [], unit: null })
    expect(r.refill).toBe(true)
  })

  it('keeps the owner target when asked', () => {
    const r = normalizeHuntPlan({ target: { product: 'Other' }, searchQueries: ['q'] }, current, true)
    expect(r.target).toBe(current)
  })
})

describe('normalizeSelect', () => {
  const allowed = new Set(['https://a.be/x', 'https://b.be/y'])
  it('drops foreign urls and dedupes', () => {
    const r = normalizeSelect(
      {
        offers: [
          { url: 'https://a.be/x?utm_source=1', shop: 'A', title: 'x', price: 5 },
          { url: 'https://a.be/x', shop: 'A', title: 'x' },
          { url: 'https://evil.example/', shop: 'E', title: 'x' },
        ],
      },
      allowed,
    )
    expect(r).toHaveLength(1)
    expect(r[0].price).toBe(5)
  })

  it('caps at 10', () => {
    const urls = Array.from({ length: 12 }, (_, i) => `https://s${i}.be/p`)
    const r = normalizeSelect({ offers: urls.map((url) => ({ url, shop: 's', title: 't' })) }, new Set(urls))
    expect(r).toHaveLength(10)
  })

  it('throws invalid when none is left', () => {
    expect(() => normalizeSelect({ offers: [{ url: 'https://z.be', shop: 'z', title: 't' }] }, allowed)).toThrow(ResearchError)
  })
})

describe('normalizeOffers', () => {
  const sel = new Set(['https://a.be/x'])
  const one = (extra: Record<string, unknown>) =>
    normalizeOffers({ offers: [{ url: 'https://a.be/x', title: 't', ...extra }] }, sel)[0].facts

  it('marks a page that only sends buyers to another shop', () => {
    const [a] = normalizeOffers({ offers: [{ url: 'https://a.be/x', title: 't', match: 'exact', referral: true }] }, sel)
    expect(a?.referral).toBe(true)
    expect(normalizeOffers({ offers: [{ url: 'https://a.be/x', title: 't' }] }, sel)[0]?.referral).toBe(false)
  })

  it('drops urls that were not selected', () => {
    expect(normalizeOffers({ offers: [{ url: 'https://z.be', title: 't', match: 'exact' }] }, sel)).toEqual([])
  })

  it('cleans delivery, packs and match', () => {
    const f = one({ match: 'maybe', mismatch: 'a b c d e f', packs: 0, delivery: { kind: 'teleport', cost: -2, threshold: 'x' } })
    expect(f.match).toBe('mismatch')
    expect(f.mismatch).toBe('a b c d')
    expect(f.packs).toBe(1)
    expect(f.delivery).toEqual({ kind: 'unknown', cost: null, threshold: null })
  })

  it('keeps a stated delivery', () => {
    const f = one({ match: 'exact', packs: 2, delivery: { kind: 'free_over', cost: 4.5, threshold: 49 } })
    expect(f.match).toBe('exact')
    expect(f.mismatch).toBeNull()
    expect(f.packs).toBe(2)
    expect(f.delivery).toEqual({ kind: 'free_over', cost: 4.5, threshold: 49 })
  })
})

describe('system prompts', () => {
  it('all carry the shop rules', () => {
    for (const s of [HUNT_PLAN_SYSTEM, SELECT_SYSTEM, OFFER_SYSTEM]) expect(s).toContain(SHOP_RULES)
  })
})
