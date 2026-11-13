import { describe, expect, it } from 'vitest'
import { clockTime } from './format'

describe('clockTime', () => {
  it('reads 24-hour time, with the weekday on another day', () => {
    const now = new Date(2026, 10, 12, 9, 0)
    expect(clockTime(new Date(2026, 10, 12, 15, 30).toISOString(), now)).toBe('15:30')
    expect(clockTime(new Date(2026, 10, 16, 15, 30).toISOString(), now)).toBe('Mon 15:30')
  })
})
