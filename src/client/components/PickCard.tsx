import { useState, type SyntheticEvent } from 'react'
import type { Availability, Pick, PickSupplier } from '../../types'
import { formatEur, hostOf } from '../lib/format'
import { AlertIcon, BagIcon, CheckIcon, ChevronIcon, ExternalIcon, StarIcon } from './icons'

interface Props {
  pick: Pick
  /** The idea's budget, to flag offers above it. */
  budget: number | null
  /** Shown on the wanted list: records this pick as the one you bought. */
  onBought?: () => void
}

const STOCK_LABEL: Record<Availability, string | null> = {
  in_stock: 'In stock',
  out_of_stock: 'Sold out',
  preorder: 'Pre-order',
  unknown: null,
}

export function PickCard({ pick, budget, onBought }: Props) {
  const [showShops, setShowShops] = useState(false)
  const best = pick.suppliers[0]
  const others = pick.suppliers.slice(1)
  const overBudget = budget !== null && pick.price !== null && pick.price > budget

  return (
    <li className="pick">
      <div className="pick-media">
        {pick.image ? (
          <img src={pick.image} alt="" loading="lazy" referrerPolicy="no-referrer" onError={hideBroken} />
        ) : (
          <span className="pick-rank" aria-hidden="true">
            {pick.rank}
          </span>
        )}
      </div>

      <div className="pick-body">
        <div className="pick-top">
          <h4 className="pick-title">{pick.title}</h4>
          {pick.price !== null && best && <Price offer={best} />}
        </div>

        <div className="pick-facts">
          {pick.rating && (
            <span className="fact" title={`${pick.rating.value} out of 5`}>
              <StarIcon className="star" /> {pick.rating.value.toFixed(1)}
              {pick.rating.count ? <span className="fact-faint"> ({pick.rating.count})</span> : null}
            </span>
          )}
          {best && <Stock availability={best.availability} />}
          {overBudget && <span className="tag tag-warn">over budget</span>}
        </div>

        {pick.why && <p className="pick-why">{pick.why}</p>}
        {pick.caveat && (
          <p className="pick-caveat">
            <AlertIcon className="pick-caveat-icon" />
            <span>
              <span className="visually-hidden">Watch out: </span>
              {pick.caveat}
            </span>
          </p>
        )}

        <div className="pick-actions">
          <a className="btn btn-shop" href={pick.url} target="_blank" rel="noreferrer noopener">
            {pick.shop || hostOf(pick.url)} <ExternalIcon />
          </a>
          {others.length > 0 && (
            <button
              type="button"
              className="btn-text"
              aria-expanded={showShops}
              onClick={() => setShowShops((v) => !v)}
            >
              {showShops ? 'hide' : `+${others.length}`} shop{others.length === 1 ? '' : 's'}
              <ChevronIcon className={showShops ? 'chevron chevron-open' : 'chevron'} />
            </button>
          )}
          {onBought && (
            <button type="button" className="btn-text btn-bought" onClick={onBought}>
              <BagIcon /> I bought this
            </button>
          )}
        </div>

        {showShops && (
          <ul className="offers" aria-label={`Other shops for ${pick.title}`}>
            {others.map((s) => (
              <li key={s.url} className="offer">
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.shop} <span className="offer-host">{hostOf(s.url)}</span>
                </a>
                <Stock availability={s.availability} />
                {s.price !== null && <Price offer={s} />}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  )
}

/** A price read from the shop page shows a check; one only seen in search is approximate. */
function Price({ offer }: { offer: PickSupplier }) {
  if (offer.price === null) return null
  return offer.checked ? (
    <span className="price" title="Price read from the shop page">
      {formatEur(offer.price)}
      <CheckIcon className="price-check" aria-label="checked at the shop" aria-hidden={false} role="img" />
    </span>
  ) : (
    <span className="price price-approx" title="Price as seen in search results: check the shop">
      ≈ {formatEur(offer.price)}
    </span>
  )
}

function Stock({ availability }: { availability: Availability }) {
  const label = STOCK_LABEL[availability]
  if (!label) return null
  return <span className={`tag tag-${availability.replace('_', '-')}`}>{label}</span>
}

function hideBroken(e: SyntheticEvent<HTMLImageElement>) {
  e.currentTarget.style.visibility = 'hidden'
}
