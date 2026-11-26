import { describe, expect, it } from 'vitest'
import type { Delivery } from './index'
import { freeDeliveryAt, priceEach } from './bulk'

const over = (threshold: number): Delivery => ({ kind: 'free_over', cost: 5.95, threshold })

describe('priceEach', () => {
  it('takes the cheapest tier that applies', () => {
    const bulk = [
      { min: 6, each: null, percentOff: 5 },
      { min: 12, each: 5.75, percentOff: null },
    ]
    expect(priceEach(6.59, bulk, 1)).toBe(6.59)
    expect(priceEach(6.59, bulk, 6)).toBe(6.26)
    expect(priceEach(6.59, bulk, 12)).toBe(5.75)
    expect(priceEach(6.59, undefined, 12)).toBe(6.59)
  })
})

describe('freeDeliveryAt', () => {
  it('finds the smallest quantity that reaches the threshold', () => {
    expect(freeDeliveryAt(6.59, over(75))).toEqual({ qty: 12, each: 6.59 })
  })
  it('counts a bulk price against the threshold', () => {
    expect(freeDeliveryAt(6.59, over(75), [{ min: 12, each: 6, percentOff: null }])).toEqual({ qty: 13, each: 6 })
  })
  it('has nothing to say when one item is enough or delivery is not free-over', () => {
    expect(freeDeliveryAt(80, over(75))).toBeNull()
    expect(freeDeliveryAt(6.59, { kind: 'paid', cost: 4, threshold: null })).toBeNull()
    expect(freeDeliveryAt(null, over(75))).toBeNull()
  })
})
