import { describe, expect, it } from 'vitest'
import { boughtLine, clockTime, priceText } from './format'

describe('clockTime', () => {
  it('reads 24-hour time, with the weekday on another day', () => {
    const now = new Date(2026, 10, 12, 9, 0)
    expect(clockTime(new Date(2026, 10, 12, 15, 30).toISOString(), now)).toBe('15:30')
    expect(clockTime(new Date(2026, 10, 16, 15, 30).toISOString(), now)).toBe('Mon 15:30')
  })
})

describe('boughtLine and priceText', () => {
  it('reads what, where, price and when, skipping the unknown', () => {
    const b = { title: 'Headwind', shop: 'Bikeshop', url: 'https://x.be', price: 249.99, at: '2026-11-07T10:00:00Z' }
    expect(boughtLine(b)).toMatch(/^Headwind · Bikeshop · €\s249,99 · 7 Nov$/)
    expect(boughtLine({ ...b, shop: '', price: null, at: 'never' })).toBe('Headwind')
  })

  it('marks a checked price and hedges a search price', () => {
    expect(priceText(229, true)).toMatch(/^€\s229 ✓$/)
    expect(priceText(229, false)).toMatch(/^≈ €\s229$/)
  })
})
