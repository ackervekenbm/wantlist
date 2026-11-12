import { useId, useState, type ReactNode } from 'react'
import type { Pick } from '../../types'
import { ChevronIcon } from './icons'

interface Props {
  /** Picks from rounds before the current one, newest round first. */
  picks: Pick[]
  renderPick: (pick: Pick) => ReactNode
}

/** One folded section per earlier round; its picks render only when open. */
export function EarlierRounds({ picks, renderPick }: Props) {
  const rounds = [...new Set(picks.map((p) => p.round))]
  if (rounds.length === 0) return null
  return (
    <div className="rounds">
      {rounds.map((round) => (
        <Round key={round} round={round} picks={picks.filter((p) => p.round === round)} renderPick={renderPick} />
      ))}
    </div>
  )
}

function Round({ round, picks, renderPick }: { round: number; picks: Pick[]; renderPick: Props['renderPick'] }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const count = (r: Pick['reaction']) => picks.filter((p) => p.reaction === r).length
  return (
    <section className="rounds-round">
      <button
        type="button"
        className="btn-text rounds-toggle"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        Round {round} · {picks.length} pick{picks.length === 1 ? '' : 's'} · {count('no')} no · {count('maybe')} kind of
        · {count('yes')} yes
        <ChevronIcon className={open ? 'chevron chevron-open' : 'chevron'} />
      </button>
      <div id={id}>
        {open && (
          <ol className="picks" aria-label={`Round ${round} picks`}>
            {picks.map(renderPick)}
          </ol>
        )}
      </div>
    </section>
  )
}
