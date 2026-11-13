import type { Pick, PickPatch } from '../../types'
import { Section } from './Leader'
import { PickRow } from './PickRow'

interface Props {
  /** `yes` picks from earlier rounds. */
  picks: Pick[]
  /** Both absent off the wanted list. */
  onReact?: (pickId: number, patch: PickPatch) => Promise<void>
  onBought?: (pick: Pick) => void
}

/** Picks you said yes to in earlier rounds, still reactable. */
export function Keepers({ picks, onReact, onBought }: Props) {
  if (picks.length === 0) return null
  return (
    <Section className="panel" title="Keepers" count={picks.length}>
      <ul className="card erows" aria-label="Keepers">
        {picks.map((pick) => (
          <PickRow key={pick.id} pick={pick} onReact={onReact} onBought={onBought} />
        ))}
      </ul>
    </Section>
  )
}
