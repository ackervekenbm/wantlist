import type { Idea, ServerStatus } from '../../types'

/** Why a wanted idea is on the Needs you list. */
export type Need = 'react' | 'nothing-new' | 'stopped'

/** Picks of the newest round (picks arrive newest round first). */
export function latestPicks(idea: Idea) {
  const round = idea.picks[0]?.round
  return idea.picks.filter((p) => p.round === round)
}

/** Needs you: unreacted picks in the latest round, nothing new found, or stopped. Wanted ideas only. */
export function needOf(idea: Idea): Need | null {
  if (idea.list !== 'wanted') return null
  if (idea.status === 'error') return idea.errorKind === 'nothing-new' ? 'nothing-new' : 'stopped'
  if (idea.status === 'done' && latestPicks(idea).some((p) => !p.reaction)) return 'react'
  return null
}

/** With the researcher: a wanted idea queued (retries included) or being researched. */
export function isWorking(idea: Idea): boolean {
  return idea.list === 'wanted' && (idea.status === 'queued' || idea.status === 'researching')
}

/** When every model is out of quota, the earliest reset (ISO-8601); else null. */
export function quotaResetAt(status: ServerStatus): string | null {
  const benched = status.models.map((m) => m.benchedUntil)
  if (benched.length === 0 || benched.some((b) => !b)) return null
  return (benched as string[]).sort()[0]
}

/** The title an idea shows: the model's (or yours) once researched, else what you typed. */
export function shownTitle(idea: Idea): string {
  return idea.round > 0 ? (idea.title ?? idea.text) : idea.text
}

/** The live research step when the researcher is on this idea, else null. */
export function stepOf(status: ServerStatus | null, ideaId: number): string | null {
  return status?.current?.ideaId === ideaId ? status.current.step : null
}
