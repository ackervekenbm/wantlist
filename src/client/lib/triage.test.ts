import { describe, expect, it } from 'vitest'
import { shownTitle } from '../components/IdeaTitle'
import { idea, pick, status } from '../test/fakeApi'
import { isWorking, needOf, quotaResetAt } from './triage'

describe('needOf', () => {
  it('asks for reactions while the latest round has an unreacted pick', () => {
    expect(needOf(idea({ picks: [pick({ reaction: 'yes' }), pick({ id: 2 })] }))).toBe('react')
  })

  it('lets a fully reacted round go, even with unreacted picks in earlier rounds', () => {
    const picks = [pick({ id: 2, round: 2, reaction: 'no' }), pick({ id: 1, round: 1 })]
    expect(needOf(idea({ round: 2, picks }))).toBeNull()
  })

  it('tells nothing new from stopped, and counts a missing kind as stopped', () => {
    expect(needOf(idea({ status: 'error', errorKind: 'nothing-new' }))).toBe('nothing-new')
    expect(needOf(idea({ status: 'error', errorKind: 'stopped' }))).toBe('stopped')
    expect(needOf(idea({ status: 'error', errorKind: null }))).toBe('stopped')
  })

  it('only looks at the wanted list, and not at ideas still being researched', () => {
    expect(needOf(idea({ list: 'bought' }))).toBeNull()
    expect(needOf(idea({ list: 'archived', status: 'error' }))).toBeNull()
    expect(needOf(idea({ status: 'queued' }))).toBeNull()
  })
})

describe('isWorking', () => {
  it('is true for wanted ideas queued, retrying or being researched', () => {
    expect(isWorking(idea({ status: 'queued' }))).toBe(true)
    expect(isWorking(idea({ status: 'queued', nextAttemptAt: '2026-11-12T15:00:00Z' }))).toBe(true)
    expect(isWorking(idea({ status: 'researching' }))).toBe(true)
    expect(isWorking(idea({ status: 'done' }))).toBe(false)
    expect(isWorking(idea({ status: 'queued', list: 'archived' }))).toBe(false)
  })
})

describe('quotaResetAt', () => {
  it('gives the earliest reset only when every model is benched', () => {
    const a = { id: 'a', benchedUntil: '2026-11-12T09:00:00Z', reason: 'quota' as const }
    const b = { id: 'b', benchedUntil: '2026-11-12T08:00:00Z', reason: 'quota' as const }
    expect(quotaResetAt(status({ models: [a, b] }))).toBe('2026-11-12T08:00:00Z')
    expect(quotaResetAt(status({ models: [a, { id: 'c', benchedUntil: null, reason: null }] }))).toBeNull()
    expect(quotaResetAt(status({ models: [] }))).toBeNull()
  })
})

describe('shownTitle', () => {
  it("keeps the owner's words until the first round is in", () => {
    expect(shownTitle(idea({ round: 0, status: 'researching', title: 'Quiet fan', text: 'a fan' }))).toBe('a fan')
    expect(shownTitle(idea({ round: 1, title: 'Quiet fan', text: 'a fan' }))).toBe('Quiet fan')
  })
})
