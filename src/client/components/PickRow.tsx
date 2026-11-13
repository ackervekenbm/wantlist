import type { Pick, PickPatch } from '../../types'
import { priceText } from '../lib/format'
import { ExternalIcon } from './icons'
import { Leader } from './Leader'
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
  return (
    <li className="erow">
      <Leader fig={pick.price === null ? '–' : priceText(pick.price, pick.suppliers[0]?.checked ?? false)}>
        {pick.title}
      </Leader>
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
