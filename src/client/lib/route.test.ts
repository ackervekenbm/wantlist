import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { parseHash, toHash, useRoute, type Route } from './route'

describe('routes', () => {
  it('round-trips every route through the hash', () => {
    const routes: Route[] = [
      { name: 'home' },
      { name: 'idea', id: 42 },
      { name: 'lists', tab: 'wanted' },
      { name: 'lists', tab: 'bought' },
      { name: 'lists', tab: 'archived' },
    ]
    for (const r of routes) expect(parseHash(toHash(r))).toEqual(r)
    expect(toHash({ name: 'home' })).toBe('#/')
    expect(toHash({ name: 'idea', id: 7 })).toBe('#/idea/7')
    expect(toHash({ name: 'lists', tab: 'bought' })).toBe('#/lists/bought')
  })

  it('treats anything unknown as home', () => {
    for (const h of ['', '#', '#/idea/abc', '#/idea/0', '#/nope', '#/lists/pantry']) {
      expect(parseHash(h)).toEqual({ name: 'home' })
    }
  })

  it('follows hashchange and replaces without a new history entry', async () => {
    const { result } = renderHook(() => useRoute())
    expect(result.current[0]).toEqual({ name: 'home' })

    act(() => result.current[1]({ name: 'idea', id: 3 }))
    await act(async () => {
      await new Promise((r) => window.addEventListener('hashchange', r, { once: true }))
    })
    expect(location.hash).toBe('#/idea/3')
    expect(result.current[0]).toEqual({ name: 'idea', id: 3 })

    const entries = history.length
    act(() => result.current[1]({ name: 'lists', tab: 'archived' }, { replace: true }))
    expect(location.hash).toBe('#/lists/archived')
    expect(result.current[0]).toEqual({ name: 'lists', tab: 'archived' })
    expect(history.length).toBe(entries)
  })
})
