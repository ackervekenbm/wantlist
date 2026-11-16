import { describe, expect, it } from 'vitest'
import type { Delivery, OfferFacts, Purchase } from '../../types'
import { idea, pick } from '../test/fakeApi'
import { deliveryText, perUnitText } from './format'
import { bestOffer, exploreRounds, huntEyebrow, offersOf, versusLast } from './hunt'
import { needOf, pantryOf } from './triage'

const facts = (over: Partial<OfferFacts> = {}): OfferFacts => ({
  match: 'exact',
  mismatch: null,
  packs: 1,
  unitsPerPack: 3,
  delivery: { kind: 'free', cost: null, threshold: null },
  delivered: 59.95,
  perUnit: 19.98,
  condition: 'new',
  sellerNote: null,
  group: 'best',
  ...over,
})
const offer = (id: number, over: Partial<OfferFacts> = {}, round = 2) =>
  pick({ id, round, kind: 'offer', offer: facts(over) })
const last: Purchase = {
  id: 1, ideaId: 1, at: '2026-10-01T10:00:00Z', shop: 'Zooplus', url: null, title: 'Feliway',
  packs: 1, unitsPerPack: 3, unitLabel: 'vial', paid: 65.85, perUnit: 21.95,
}

describe('hunt helpers', () => {
  const hunt = idea({
    mode: 'hunt',
    target: { product: 'Feliway', variant: '3 vials', condition: 'new', exclude: [], unit: 'vial' },
    picks: [offer(3), offer(4, { group: 'exact' }), offer(2, {}, 1), pick({ id: 9, round: 1 })],
    purchases: [last],
  })

  it('splits the latest hunt round from explore picks', () => {
    expect(offersOf(hunt).map((p) => p.id)).toEqual([3, 4])
    expect(exploreRounds(hunt).map((p) => p.id)).toEqual([9])
    expect(bestOffer(hunt)?.id).toBe(3)
  })

  it('compares per unit with the last purchase (Feliway: -9%)', () => {
    expect(versusLast(hunt, offersOf(hunt)[0])?.pct).toBe(-9)
    const noUnit = offer(5, { perUnit: null, delivered: 72.4 })
    expect(versusLast({ ...hunt, purchases: [{ ...last, perUnit: null }] }, noUnit)?.pct).toBe(10)
    expect(versusLast({ ...hunt, purchases: [] }, noUnit)).toBeNull()
  })

  it('names the hunt from refill', () => {
    expect(huntEyebrow({ ...hunt, refill: true })).toBe('HUNT · REFILL')
    expect(huntEyebrow({ ...hunt, refill: false })).toBe('HUNT · ONE-OFF')
  })

  it('puts a done hunt in Needs you and a covered one in the Pantry', () => {
    expect(needOf(hunt)).toBe('offer')
    const covered = { ...hunt, list: 'bought' as const, refill: true }
    expect(needOf(covered)).toBeNull()
    expect(pantryOf([hunt, covered])).toEqual([covered])
  })
})

describe('per unit and delivery text', () => {
  it('formats both', () => {
    expect(perUnitText(19.98, 'vial')).toBe('€19,98/vial')
    const d = (kind: Delivery['kind'], cost: number | null = null, threshold: number | null = null): Delivery => ({ kind, cost, threshold })
    expect(deliveryText(d('free'), 50)).toBe('free')
    expect(deliveryText(d('paid', 4.95), 50)).toMatch(/^€\s4,95$/)
    expect(deliveryText(d('free_over', null, 49), 52)).toMatch(/^free over €\s49 ✓$/)
    expect(deliveryText(d('free_over', null, 49), 30)).toMatch(/^free over €\s49$/)
    expect(deliveryText(d('unknown'), null)).toBe('delivery not shown')
    expect(deliveryText(d('pickup_only'), null)).toBe('pick-up only')
    expect(deliveryText(d('no_be'), null)).toBe('no delivery to Belgium')
  })
})
