import type { HistoryPick, Idea, Pick, ResearchHistory } from '../types'

function toHistoryPick(p: Pick): HistoryPick {
  return {
    round: p.round,
    title: p.title,
    shop: p.shop,
    price: p.price,
    why: p.why,
    reaction: p.reaction,
    reason: p.reason,
    urls: [...new Set([p.url, ...p.suppliers.map((s) => s.url)])],
  }
}

/** What the next round should know about the earlier ones; null before the first round. */
export function buildHistory(idea: Idea): ResearchHistory | null {
  if (idea.round === 0) return null
  const fresh = idea.freshSinceRound
  if (fresh !== null && idea.preferences === null) {
    return {
      mode: 'fresh',
      preferences: null,
      preferencesEdited: false,
      picks: idea.picks.filter((p) => p.reaction === 'no').map(toHistoryPick),
    }
  }
  const since = fresh ?? 0
  return {
    mode: 'learn',
    preferences: idea.preferences,
    preferencesEdited: idea.preferencesEdited,
    picks: idea.picks.filter((p) => p.round > since || p.reaction === 'no').map(toHistoryPick),
  }
}
