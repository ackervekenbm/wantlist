import type { Idea } from '../../types'

/** The filter box: a case-insensitive match on the idea's words, title, preferences summary and pick titles. */
export function matches(idea: Idea, query: string): boolean {
  const q = query.trim().toLowerCase()
  return [idea.title, idea.text, idea.notes, idea.preferences?.summary, ...idea.picks.map((p) => p.title)].some((s) =>
    s?.toLowerCase().includes(q),
  )
}
