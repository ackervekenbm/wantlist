import type { Pick, PickPatch } from '../../types'
import { ChevronIcon } from './icons'
import { Section } from './Leader'
import { PickRow } from './PickRow'

interface Props {
  /** Every Explore pick of the idea, newest round first. */
  picks: Pick[]
  /** The round on the deck: its picks are reacted to there, so they are read-only here. */
  deckRound?: number
  /** Both absent off the wanted list. */
  onReact?: (pickId: number, patch: PickPatch) => Promise<void>
  onBought?: (pick: Pick) => void
  /** Hunts this pick's exact product. */
  onHunt?: (pick: Pick) => void
}

/** Your shortlist across all rounds: every Yes, then the Kind of picks folded, to make the final choice from. */
export function Keepers({ picks, deckRound, onReact, onBought, onHunt }: Props) {
  const yes = picks.filter((p) => p.reaction === 'yes')
  const maybe = picks.filter((p) => p.reaction === 'maybe')
  if (yes.length + maybe.length === 0) return null
  const row = (pick: Pick) => <PickRow key={pick.id} pick={pick} detail onReact={pick.round === deckRound ? undefined : onReact} onBought={onBought} onHunt={onHunt} />
  return (
    <Section className="panel" title="Keepers" count={yes.length} note="your Yes picks, every round">
      {yes.length > 0 && (
        <ul className="card erows" aria-label="Keepers">
          {yes.map(row)}
        </ul>
      )}
      {maybe.length > 0 && (
        <details className="card apart">
          <summary>
            Kind of <span className="n">{maybe.length}</span>
            <ChevronIcon className="chev" />
          </summary>
          <ul className="erows" aria-label="Kind of">
            {maybe.map(row)}
          </ul>
        </details>
      )}
    </Section>
  )
}
