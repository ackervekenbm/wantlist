import { describe, expect, it } from 'vitest'
import type { Availability, Delivery, FinalPick, HuntTarget } from '../../types'
import { deliveredPrice, rankOffers } from './rank'

const free: Delivery = { kind: 'free', cost: null, threshold: null }
const paid = (cost: number): Delivery => ({ kind: 'paid', cost, threshold: null })
const freeOver = (cost: number | null, threshold: number): Delivery => ({ kind: 'free_over', cost, threshold })
const unknown: Delivery = { kind: 'unknown', cost: null, threshold: null }
const pickup: Delivery = { kind: 'pickup_only', cost: null, threshold: null }
const noBe: Delivery = { kind: 'no_be', cost: null, threshold: null }

const target: HuntTarget = { product: 'chair', variant: '', condition: 'new', exclude: [], unit: null }

function offer(
  shop: string,
  price: number | null,
  delivery: Delivery,
  o: { packs?: number; availability?: Availability; checked?: boolean; match?: 'exact' | 'mismatch' } = {},
): FinalPick {
  return {
    rank: 0, title: shop, shop, url: `https://${shop}.be`, price, why: '', caveat: null, image: null, rating: null,
    sourceUrls: [], kind: 'offer',
    suppliers: [{ shop, url: `https://${shop}.be`, price, availability: o.availability ?? 'in_stock', checked: o.checked ?? true }],
    offer: {
      match: o.match ?? 'exact', mismatch: null, packs: o.packs ?? 1, unitsPerPack: null, delivery,
      delivered: null, perUnit: null, condition: 'new', sellerNote: null, group: 'exact',
    },
  }
}

const order = (r: FinalPick[]): string[] => r.map((p) => `${p.shop}:${p.offer?.group}`)

describe('deliveredPrice', () => {
  it('adds delivery when known', () => {
    expect(deliveredPrice(720, free)).toBe(720)
    expect(deliveredPrice(650, paid(80))).toBe(730)
    expect(deliveredPrice(60, freeOver(4.95, 49))).toBe(60)
    expect(deliveredPrice(40, freeOver(4.95, 49))).toBe(44.95)
    expect(deliveredPrice(40, freeOver(null, 49))).toBeNull()
    expect(deliveredPrice(40, unknown)).toBeNull()
    expect(deliveredPrice(null, free)).toBeNull()
  })
})

describe('rankOffers', () => {
  it('ranks the chair example by delivered price', () => {
    const input = [offer('A', 650, paid(80)), offer('B', 720, free), offer('C', 550, pickup)]
    const r = rankOffers(input, target)
    expect(order(r)).toEqual(['B:best', 'A:exact', 'C:unavailable'])
    expect(r.map((p) => p.rank)).toEqual([1, 2, 3])
    expect(r[1]?.offer?.delivered).toBe(730)
    expect(input[0]?.offer?.group).toBe('exact')
    expect(input[0]?.rank).toBe(0)
  })

  it('compares per unit when packs differ and a unit is set', () => {
    const input = [offer('Zooplus', 59.95, free, { packs: 3 }), offer('24PHARMA', 28.5, paid(4.95))]
    const r = rankOffers(input, { ...target, unit: 'vial' })
    expect(r[0]?.shop).toBe('Zooplus')
    expect(r[0]?.offer).toMatchObject({ group: 'best', perUnit: 19.98 })
    expect(r[1]?.offer?.perUnit).toBe(33.45)
    const totals = rankOffers(input, target)
    expect(totals[0]?.shop).toBe('24PHARMA')
  })

  it('lets unknown delivery win only below every known delivered price', () => {
    expect(order(rankOffers([offer('X', 100, unknown), offer('Y', 105, free)], target))).toEqual(['X:best', 'Y:exact'])
    expect(order(rankOffers([offer('X', 110, unknown), offer('Y', 105, free)], target))).toEqual(['Y:best', 'X:exact'])
  })

  it('only checked, in-stock, exact, deliverable offers can be best', () => {
    const r = rankOffers(
      [
        offer('unchecked', 10, free, { checked: false }),
        offer('oos', 20, free, { availability: 'out_of_stock' }),
        offer('nobe', 5, noBe),
        offer('wrong', 1, free, { match: 'mismatch' }),
        offer('ok', 30, free),
      ],
      target,
    )
    expect(order(r)).toEqual(['ok:best', 'unchecked:exact', 'oos:exact', 'nobe:unavailable', 'wrong:mismatch'])
  })

  it('has no best when nothing is eligible', () => {
    const r = rankOffers([offer('a', 1, free, { checked: false }), offer('b', 2, free, { checked: false })], target)
    expect(r.some((p) => p.offer?.group === 'best')).toBe(false)
  })

  it('does not crown an offer in the wrong condition', () => {
    const worn = offer('a', 1, free)
    worn.offer!.condition = 'refurbished'
    const r = rankOffers([worn, offer('b', 5, free)], target)
    expect(order(r)).toEqual(['b:best', 'a:mismatch'])
    expect(r[1].offer?.mismatch).toBe('refurbished')
  })
})

describe('rankOffers with a partner discount', () => {
  it('ranks on the price after the partner gives part back, keeping the shop price on the offer', () => {
    const input = [offer('A', 100, free), offer('B', 101, free)]
    expect(order(rankOffers(input, target))).toEqual(['A:best', 'B:exact'])
    const r = rankOffers(input, target, (url, price) => (url === 'https://B.be' ? price * 0.03 : 0))
    expect(order(r)).toEqual(['B:best', 'A:exact'])
    expect(r[0]?.offer?.delivered).toBe(101)
  })
})
