import { useId, useState } from 'react'
import type { Pick, PickPatch } from '../../types'
import { ChevronIcon } from './icons'
import { PickRow } from './PickRow'

interface Props {
  /** Picks from rounds before the current one, newest round first. */
  picks: Pick[]
  /** Absent off the wanted list. */
  onReact?: (pickId: number, patch: PickPatch) => Promise<void>
}

const SHORT = { no: 'No way', maybe: 'Kind of', yes: 'Yes' } as const

/** One folded block per earlier round; its picks render only when open. */
export function EarlierRounds({ picks, onReact }: Props) {
  const rounds = [...new Set(picks.map((p) => p.round))]
  if (rounds.length === 0) return null
  return (
    <section className="panel">
      <h2 className="sec-h">
        Earlier rounds
        <span className="rule" />
      </h2>
      <div className="card">
        {rounds.map((round) => (
          <Round key={round} round={round} picks={picks.filter((p) => p.round === round)} onReact={onReact} />
        ))}
      </div>
    </section>
  )
}

function Round({ round, picks, onReact }: { round: number; picks: Pick[]; onReact: Props['onReact'] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  return (
    <div className="round">
      <button type="button" className="round-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
        Round {round}
        <span className="tally">{picks.map((p) => (p.reaction ? SHORT[p.reaction] : '–')).join(' · ')}</span>
        <ChevronIcon className={open ? 'chev open' : 'chev'} />
      </button>
      <div id={id}>
        {open && (
          <ul className="erows" aria-label={`Round ${round} picks`}>
            {picks.map((pick) => (
              <PickRow key={pick.id} pick={pick} onReact={onReact} />
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
