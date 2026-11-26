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
  /** Hunts this pick's exact product. */
  onHunt?: (pick: Pick) => void
  /** Keepers: a photo, the why and your reason, to compare on. */
  detail?: boolean
}

/** A compact pick: title and price on a dotted leader, the shop, and its own keycaps. */
export function PickRow({ pick, onReact, onBought, onHunt, detail }: Props) {
  const lead = (
    <Leader fig={pick.price === null ? '–' : priceText(pick.price, pick.suppliers[0]?.checked ?? false)}>{pick.title}</Leader>
  )
  return (
    <li className={detail ? 'erow keeper' : 'erow'}>
      {detail ? (
        <div className="keeper-top">
          {pick.image && (
            <img
              className="thumb"
              src={pick.image}
              alt=""
              loading="lazy"
              referrerPolicy="no-referrer"
              onError={(e) => (e.currentTarget.hidden = true)}
            />
          )}
          <div className="keeper-text">
            {lead}
            {pick.why && <p className="hint">{pick.why}</p>}
            {/* With reactions the why box shows it already. */}
            {!onReact && pick.reason && <p className="hint">You: “{pick.reason}”</p>}
          </div>
        </div>
      ) : (
        lead
      )}
      <div className="erow-acts">
        <a className="linkish" href={pick.url} target="_blank" rel="noreferrer noopener">
          {pick.shop || 'Open shop'} <ExternalIcon />
        </a>
        {onBought && (
          <button type="button" className="linkish" onClick={() => onBought(pick)}>
            I bought this
          </button>
        )}
        {onHunt && (
          <button type="button" className="linkish" onClick={() => onHunt(pick)}>
            Hunt this one
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
