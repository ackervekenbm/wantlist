import { isCovered, type Idea, type ServerStatus } from '../../types'
import { bestOffer } from './hunt'

/** Why a wanted idea is on the Needs you list. */
export type Need = 'react' | 'offer' | 'nothing-new' | 'stopped'

/** Explore picks of the newest round (picks arrive newest round first). */
export function latestPicks(idea: Idea) {
  const picks = idea.picks.filter((p) => p.kind === 'pick')
  return picks.filter((p) => p.round === picks[0]?.round)
}

/** Covered hunts: bought and waiting until you run low. */
export function pantryOf(ideas: Idea[]): Idea[] {
  return ideas.filter(isCovered)
}

/** Needs you: a hunt's best offer, unreacted picks in the latest round, nothing new found, or stopped. Wanted ideas only. */
export function needOf(idea: Idea): Need | null {
  if (idea.list !== 'wanted') return null
  if (idea.status === 'error') return idea.errorKind === 'nothing-new' ? 'nothing-new' : 'stopped'
  if (idea.status === 'done' && idea.mode === 'hunt') return bestOffer(idea) ? 'offer' : null
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
