import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { goHome, navigate, parseHash, toHash, useRoute, type Route } from './route'

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

  it('pushes, replaces without a new history entry, and follows hashchange', async () => {
    history.replaceState(null, '', '#/')
    const { result } = renderHook(() => useRoute())
    expect(result.current[0]).toEqual({ name: 'home' })

    const entries = history.length
    act(() => result.current[1]({ name: 'idea', id: 3 }))
    expect(location.hash).toBe('#/idea/3')
    expect(result.current[0]).toEqual({ name: 'idea', id: 3 })
    expect(history.length).toBe(entries + 1)

    act(() => result.current[1]({ name: 'lists', tab: 'archived' }, { replace: true }))
    expect(location.hash).toBe('#/lists/archived')
    expect(result.current[0]).toEqual({ name: 'lists', tab: 'archived' })
    expect(history.length).toBe(entries + 1)

    // The same route again adds no entry.
    act(() => result.current[1]({ name: 'lists', tab: 'archived' }))
    expect(history.length).toBe(entries + 1)

    location.hash = '#/idea/5'
    await waitFor(() => expect(result.current[0]).toEqual({ name: 'idea', id: 5 }))
  })
})

describe('goHome', () => {
  it('steps back when the entry before is home, so Back does not reopen the idea', async () => {
    history.replaceState(null, '', '#/')
    const { result } = renderHook(() => useRoute())
    act(() => navigate({ name: 'idea', id: 1 }))
    const entries = history.length
    act(() => goHome())
    await waitFor(() => expect(result.current[0]).toEqual({ name: 'home' }))
    expect(location.hash).toBe('#/')
    // Back went down the stack instead of pushing home on top of the idea.
    expect(history.length).toBe(entries)
    act(() => navigate({ name: 'lists', tab: 'wanted' }))
    expect(history.length).toBe(entries)
  })

  it('replaces with home when the entry before is not home', async () => {
    history.replaceState(null, '', '#/lists/bought')
    const { result } = renderHook(() => useRoute())
    act(() => navigate({ name: 'idea', id: 2 }))
    const entries = history.length
    act(() => goHome())
    expect(result.current[0]).toEqual({ name: 'home' })
    expect(history.length).toBe(entries)
    history.back()
    await waitFor(() => expect(result.current[0]).toEqual({ name: 'lists', tab: 'bought' }))
  })

  it('replaces with home after a reload, when the entry has no in-app origin', () => {
    history.replaceState(null, '', '#/idea/4')
    const { result } = renderHook(() => useRoute())
    const entries = history.length
    act(() => goHome())
    expect(result.current[0]).toEqual({ name: 'home' })
    expect(location.hash).toBe('#/')
    expect(history.length).toBe(entries)
  })
})
