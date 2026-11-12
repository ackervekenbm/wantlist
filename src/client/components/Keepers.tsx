import type { Pick } from '../../types'
import { formatEur, hostOf } from '../lib/format'
import { BagIcon, ExternalIcon } from './icons'

interface Props {
  /** `yes` picks from earlier rounds. */
  picks: Pick[]
  /** Shown on the wanted list. */
  onBought?: (pick: Pick) => void
}

/** Picks you said yes to in earlier rounds, one line each. */
export function Keepers({ picks, onBought }: Props) {
  if (picks.length === 0) return null
  return (
    <ul className="keepers" aria-label="Keepers">
      {picks.map((pick) => {
        const best = pick.suppliers[0]
        return (
          <li key={pick.id} className="keepers-item">
            <span className="keepers-title">{pick.title}</span>
            {' · '}
            <span className="keepers-round">round {pick.round}</span>
            {pick.price !== null && (
              <>
                {' · '}
                <span className="keepers-price">
                  {best?.checked ? (
                    <>
                      {formatEur(pick.price)} <span aria-hidden="true">✓</span>
                      <span className="visually-hidden">checked at the shop</span>
                    </>
                  ) : (
                    `≈ ${formatEur(pick.price)}`
                  )}
                </span>
              </>
            )}
            {' · '}
            <a href={pick.url} target="_blank" rel="noreferrer noopener">
              {pick.shop || hostOf(pick.url)} <ExternalIcon />
            </a>
            {onBought && (
              <>
                {' · '}
                <button type="button" className="btn-text btn-bought" onClick={() => onBought(pick)}>
                  <BagIcon /> I bought this
                </button>
              </>
            )}
          </li>
        )
      })}
    </ul>
  )
}
