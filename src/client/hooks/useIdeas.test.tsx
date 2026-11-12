import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useIdeas } from './useIdeas'
import { fakeApi, idea, pick } from '../test/fakeApi'

afterEach(() => vi.unstubAllGlobals())

async function setup() {
  const fake = fakeApi([idea({ picks: [pick({ id: 1 })] })])
  const { result } = renderHook(() => useIdeas())
  await waitFor(() => expect(result.current.loaded).toBe(true))
  return { fake, result }
}

describe('useIdeas reactions', () => {
  it('saves a reaction and refines through the API', async () => {
    const { fake, result } = await setup()
    await act(() => result.current.react(1, { reaction: 'no', reason: 'too fluffy' }))
    expect(fake.writes()).toContainEqual({ method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no', reason: 'too fluffy' } })
    await act(() => result.current.refine(1))
    expect(fake.writes()).toContainEqual({ method: 'POST', path: '/api/ideas/1/refine', body: undefined })
    expect(result.current.ideas[0].status).toBe('queued')
  })

  it('shows a reaction before the server answers and rolls it back on failure', async () => {
    const { fake, result } = await setup()
    fake.failNextPickPatch()
    let done!: Promise<void>
    act(() => {
      done = result.current.react(1, { reaction: 'no' })
      done.catch(() => undefined)
    })
    expect(result.current.ideas[0].picks[0].reaction).toBe('no')
    await act(() => done.catch(() => undefined))
    expect(result.current.ideas[0].picks[0].reaction).toBeNull()
    expect(result.current.error).toBeTruthy()
  })

  it('a poll that started before a reaction does not undo it', async () => {
    const { fake, result } = await setup()
    const release = fake.holdNextList()
    act(() => {
      // a tab-focus poll, stuck at the server
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(() => result.current.react(1, { reaction: 'yes' }))
    await act(async () => {
      release()
    })
    expect(result.current.ideas[0].picks[0].reaction).toBe('yes')
  })
})
