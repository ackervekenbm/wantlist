import { useState } from 'react'
import type { Availability, Pick } from '../../types'
import { formatEur, priceText } from '../lib/format'
import { ExternalIcon, ParcelIcon, StarIcon } from './icons'
import { REACTION_LABEL } from './ReactionBar'

interface Props {
  pick: Pick
  /** The idea's budget, to flag a price above it. */
  budget: number | null
  /** Shown on the wanted list: records this pick as the one you bought. */
  onBought?: () => void
}

const STOCK: Record<Availability, string | null> = {
  in_stock: 'In stock',
  out_of_stock: 'Sold out',
  preorder: 'Pre-order',
  unknown: null,
}

/** What's on a deck card: photo, rank, your stamp, price, why, caveat and other shops. Keyed by pick by its parent. */
export function PickCard({ pick, budget, onBought }: Props) {
  const [broken, setBroken] = useState(false)
  const [best, ...others] = pick.suppliers
  const stock = best && STOCK[best.availability]
  const overBudget = budget !== null && pick.price !== null && pick.price > budget

  return (
    <>
      <div className="photo">
        {pick.image && !broken ? (
          <img
            src={pick.image}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        ) : (
          <>
            <ParcelIcon />
            <span className="ph">no photo</span>
          </>
        )}
        <span className="rank">#{pick.rank}</span>
        {pick.reaction && <span className={`stamp ${pick.reaction}`}>{REACTION_LABEL[pick.reaction]}</span>}
      </div>
      <div className="pick-body">
        <h3 className="pick-title">{pick.title}</h3>
        <p className="priceline">
          {pick.price === null ? (
            <span className="approx">no price found</span>
          ) : (
            <>
              <span className="price">{formatEur(pick.price)}</span>
              {best?.checked ? <span className="ck">✓ checked</span> : <span className="approx">≈ search price</span>}
            </>
          )}
          {pick.shop && <span className="shop" title={pick.shop}>· {pick.shop}</span>}
        </p>
        {/* Its own line, so a wrap never starts with a separator. */}
        {(stock || pick.rating || overBudget) && (
          <p className="meta">
            {stock && <span className={best.availability === 'out_of_stock' ? 'bad' : undefined}>{stock}</span>}
            {pick.rating && (
              <span title={`${pick.rating.value} out of 5`}>
                <StarIcon className="star" /> {pick.rating.value.toFixed(1)}
                {pick.rating.count ? ` (${pick.rating.count})` : null}
              </span>
            )}
            {overBudget && <span className="bad">over budget</span>}
          </p>
        )}
        {pick.why && <p className="why">{pick.why}</p>}
        {pick.caveat && (
          <p className="caveat">
            <b>Check:</b> {pick.caveat}
          </p>
        )}
        {others.length > 0 && (
          <p className="caveat">
            Also at{' '}
            {others.map((s, i) => (
              <span key={s.url}>
                {i > 0 && ', '}
                <a href={s.url} target="_blank" rel="noreferrer noopener">
                  {s.shop}
                </a>
                {s.price !== null && ` ${priceText(s.price, s.checked)}`}
                {s.availability === 'out_of_stock' && ' (sold out)'}
              </span>
            ))}
          </p>
        )}
      </div>
      <div className="pick-foot">
        {onBought ? (
          <button type="button" className="linkish" onClick={onBought}>
            I bought this
          </button>
        ) : (
          <span />
        )}
        <a className="linkish" href={pick.url} target="_blank" rel="noreferrer noopener">
          Open shop <ExternalIcon />
        </a>
      </div>
    </>
  )
}
