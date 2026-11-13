import type { Pick, PickPatch } from '../../types'
import { formatEur } from '../lib/format'
import { ExternalIcon } from './icons'
import { ReactionBar } from './ReactionBar'

interface Props {
  pick: Pick
  /** Absent off the wanted list: the row is read-only. */
  onReact?: (pickId: number, patch: PickPatch) => Promise<void>
  /** Records this pick as the one you bought (wanted ideas). */
  onBought?: (pick: Pick) => void
}

/** A compact pick: title and price on a dotted leader, the shop, and its own keycaps. */
export function PickRow({ pick, onReact, onBought }: Props) {
  const checked = pick.suppliers[0]?.checked
  return (
    <li className="erow">
      <div className="lead">
        <span className="t">{pick.title}</span>
        <span className="l" />
        <span className="f">
          {pick.price === null ? '–' : `${checked ? '' : '≈ '}${formatEur(pick.price)}${checked ? ' ✓' : ''}`}
        </span>
      </div>
      <div className="erow-acts">
        <a className="linkish" href={pick.url} target="_blank" rel="noreferrer noopener">
          {pick.shop || 'Open shop'} <ExternalIcon />
        </a>
        {onBought && (
          <button type="button" className="linkish" onClick={() => onBought(pick)}>
            I bought this
          </button>
        )}
      </div>
      {onReact && (
        <ReactionBar
          key={pick.id}
          title={pick.title}
          reaction={pick.reaction}
          reason={pick.reason}
          onReact={(patch) => onReact(pick.id, patch)}
        />
      )}
    </li>
  )
}
