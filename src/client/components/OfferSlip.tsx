import type { Availability, Idea, Pick } from '../../types'
import { clockTime, deliveryText, eurTight, perUnitText, shortDate } from '../lib/format'
import { figureOf, offersOf, packText, versusLast } from '../lib/hunt'
import { ExternalIcon } from './icons'
import { Leader } from './Leader'

interface Props {
  idea: Idea
  best: Pick
  /** The unit offers are compared per, or null for delivered totals. */
  unit: string | null
  onBought: (offer: Pick) => void
}

export const STOCK: Record<Availability, string> = {
  in_stock: 'In stock',
  out_of_stock: 'Sold out',
  preorder: 'Pre-order',
  unknown: 'Stock unknown',
}

/** A figure as shown: "€19,98/vial" or "€59,95". */
export function figureText(amount: number, unit: string | null): string {
  return unit ? perUnitText(amount, unit) : eurTight(amount)
}

/** The best real offer on a perforated slip: shop, the receipt lines, the price you compare on, and buying. */
export function OfferSlip({ idea, best, unit, onBought }: Props) {
  const f = best.offer
  if (!f) return null
  const fig = figureOf(best, unit)
  const pay = f.delivered ?? best.price
  const checkedAt = best.fetchedAt ?? idea.researchedAt
  const vs = versusLast(idea, best)
  const lastFig = vs && (vs.last.perUnit !== null && f.perUnit !== null ? figureText(vs.last.perUnit, vs.last.unitLabel ?? unit) : eurTight(vs.last.paid))
  // A cheaper price seen only in search gets one quiet line, never the slip.
  const cheaper = offersOf(idea)
    .filter((o) => o.offer?.group === 'exact' && !o.suppliers[0]?.checked)
    .map((o) => ({ o, fig: figureOf(o, unit) }))
    .filter((x): x is { o: Pick; fig: number } => x.fig !== null && fig !== null && x.fig < fig)
    .sort((a, b) => a.fig - b.fig)[0]

  return (
    <div className="slipwrap">
      <div className="slip" role="group" aria-label="Best real offer">
        <p className="slip-h">
          <span className="best">Best real offer</span>
          <span>✓ checked{checkedAt && ` ${clockTime(checkedAt)}`}</span>
        </p>
        <p className="slip-shop">
          <b>{best.shop}</b>
          <span className="trust">{STOCK[best.suppliers[0]?.availability ?? 'unknown']}</span>
        </p>
        {f.sellerNote && <p className="trust">{f.sellerNote}</p>}
        <ul className="qlines">
          {best.price !== null && (
            <li>
              <Leader fig={eurTight(best.price)}>{f.packs > 1 || unit ? packText(f.packs, idea, 'Price') : 'Price'}</Leader>
            </li>
          )}
          <li>
            <Leader fig={deliveryText(f.delivery, best.price)}>Delivery</Leader>
          </li>
        </ul>
        {fig !== null && (
          <div className="total">
            <span className="lab">
              {unit ? (
                <>
                  Per {unit}
                  {pay !== null && (
                    <>
                      <br />
                      you pay {eurTight(pay)}
                    </>
                  )}
                </>
              ) : (
                <>
                  You pay
                  <br />
                  {f.delivered === null ? 'delivery not shown' : 'delivery included'}
                </>
              )}
            </span>
            <span className="big">
              {eurTight(fig)}
              {unit && <small>/{unit}</small>}
            </span>
          </div>
        )}
        {(vs || idea.purchases.length === 0) && (
          <p className="vs">
            {vs ? (
              <>
                {vs.pct === 0 ? <b>Same</b> : <b className={vs.pct > 0 ? 'up' : undefined}>{Math.abs(vs.pct)}% {vs.pct > 0 ? 'more' : 'less'}</b>}{' '}
                {vs.pct === 0 ? 'as' : 'than'} last time · {lastFig}
                {vs.last.shop && ` at ${vs.last.shop}`}, {shortDate(vs.last.at)}
              </>
            ) : (
              'First time buying this.'
            )}
          </p>
        )}
        {cheaper && (
          <p className="vs quiet">
            ≈ {figureText(cheaper.fig, unit)} at {cheaper.o.shop}, price not confirmed at the shop
          </p>
        )}
        <div className="slip-acts">
          <button type="button" className="btn primary" onClick={() => onBought(best)}>
            Bought here
          </button>
          <a className="btn" href={best.url} target="_blank" rel="noreferrer noopener">
            Open shop <ExternalIcon />
          </a>
        </div>
      </div>
    </div>
  )
}
