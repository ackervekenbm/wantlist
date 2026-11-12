import type { Idea, Pick, PickPatch } from '../../types'
import { latestPicks } from '../lib/triage'
import { PickCard } from './PickCard'
import { ReactionBar } from './ReactionBar'

// shortcut: the latest round as a plain list; Task 6 replaces this file with the deck.

interface Props {
  idea: Idea
  onReact: (pickId: number, patch: PickPatch) => Promise<void>
  onBought: (pick: Pick) => void
}

/** The newest round's picks; reactions and "I bought this" only on a wanted idea. */
export function PickList({ idea, onReact, onBought }: Props) {
  const picks = latestPicks(idea)
  const wanted = idea.list === 'wanted'
  if (picks.length === 0) return null
  return (
    <ol className="picks" aria-label={`Round ${picks[0].round} picks`}>
      {picks.map((pick) => (
        <PickCard
          key={pick.id}
          pick={pick}
          budget={idea.budget}
          onBought={wanted ? () => onBought(pick) : undefined}
          reaction={
            wanted && (
              <ReactionBar
                title={pick.title}
                reaction={pick.reaction}
                reason={pick.reason}
                onReact={(patch) => onReact(pick.id, patch)}
              />
            )
          }
        />
      ))}
    </ol>
  )
}
