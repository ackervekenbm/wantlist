import { describe, expect, it } from 'vitest'
import { buildHistory } from '../src/server/history'
import type { Idea, Pick, Reaction } from '../src/types'

const prefs = { summary: 's', mustHaves: [], avoid: [], likes: [] }

function pick(round: number, title: string, reaction: Reaction | null, extra: Partial<Pick> = {}): Pick {
  return {
    id: 0, ideaId: 1, rank: 1, round, reaction, reason: null, title, shop: 'Shop', url: `https://s.be/${title}`,
    price: 10, why: 'w', caveat: null, image: null, rating: null, sourceUrls: [], fetchedAt: null,
    suppliers: [], ...extra,
  }
}

function idea(extra: Partial<Idea>): Idea {
  return {
    id: 1, text: 'fan', budget: null, notes: null, list: 'wanted', bought: null, status: 'done',
    createdAt: '', researchedAt: null, error: null, attempts: 0, nextAttemptAt: null, title: null,
    titleByOwner: false, round: 1, preferences: prefs, preferencesEdited: false, freshSinceRound: null,
    picks: [], ...extra,
  }
}

describe('buildHistory', () => {
  it('has no history before the first round', () => {
    expect(buildHistory(idea({ round: 0 }))).toBeNull()
  })

  it('learns from every pick, with reactions and all their shop URLs', () => {
    const sup = (url: string) => ({ shop: 'x', url, price: null, availability: 'unknown' as const, checked: false })
    const h = buildHistory(
      idea({
        round: 2,
        picks: [
          pick(2, 'a', 'yes', { suppliers: [sup('https://s.be/a'), sup('https://alt.eu/a')] }),
          pick(2, 'b', 'maybe'),
          pick(1, 'c', 'no'),
          pick(1, 'd', 'yes'),
        ],
      }),
    )!
    expect(h.mode).toBe('learn')
    expect(h.picks).toHaveLength(4)
    expect(h.picks[0].urls).toEqual(['https://s.be/a', 'https://alt.eu/a'])
  })

  it('treats an idea from before rounds as round 1 history', () => {
    const h = buildHistory(idea({ round: 1, picks: [pick(1, 'a', null)] }))!
    expect(h.mode).toBe('learn')
    expect(h.picks).toHaveLength(1)
  })

  it('a fresh start keeps only the rejected products', () => {
    const h = buildHistory(
      idea({ round: 2, preferences: null, freshSinceRound: 1, picks: [pick(1, 'a', 'no'), pick(1, 'b', 'yes')] }),
    )!
    expect(h.mode).toBe('fresh')
    expect(h.picks.map((p) => p.title)).toEqual(['a'])
  })

  it('after a fresh start, learns only from later rounds plus earlier rejects', () => {
    const h = buildHistory(
      idea({
        round: 2,
        freshSinceRound: 1,
        picks: [pick(2, 'm', 'maybe'), pick(1, 'n', 'no'), pick(1, 'y', 'yes')],
      }),
    )!
    expect(h.mode).toBe('learn')
    expect(h.picks.map((p) => p.title).sort()).toEqual(['m', 'n'])
  })
})
