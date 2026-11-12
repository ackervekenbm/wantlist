import { describe, expect, it } from 'vitest'
import { parseBudget } from './IdeaForm'

describe('parseBudget', () => {
  it.each([
    ['', null],
    ['150', 150],
    ['89,99', 89.99],
    ['€ 89.5', 89.5],
    ['0', undefined],
    ['cheap', undefined],
    ['1.299', undefined],
  ])('%s → %s', (input, expected) => {
    expect(parseBudget(input)).toBe(expected)
  })
})
