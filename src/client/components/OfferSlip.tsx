import type { Availability, Idea, Pick } from '../../types'
import { clockTime, eurTight, perUnitText, shortDate } from '../lib/format'
import { priceEach } from '../../types/bulk'
import { bulkText, figureOf, freeDeliveryHint, offersOf, packText, quantityOf, versusLast } from '../lib/hunt'
import { ExternalIcon } from './icons'
import { Leader } from './Leader'
import { DeliveryButton, deliveryFig } from './OfferList'
import { PartnerNote } from './PartnerNote'

interface Props {
  idea: Idea
  best: Pick
  /** The unit offers are compared per, or null for delivered totals. */
  unit: string | null
  onBought: (offer: Pick) => void
  onDelivery: (offer: Pick) => void
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
export function OfferSlip({ idea, best, unit, onBought, onDelivery }: Props) {
  const f = best.offer
  if (!f) return null
  const qty = quantityOf(idea)
  const each = best.price === null ? null : priceEach(best.price, f.bulk, qty)
  const items = each === null ? null : each * qty
  const fig = figureOf(best, unit, qty)
  const pay = f.delivered ?? items
  const checkedAt = best.fetchedAt ?? idea.researchedAt
  const vs = versusLast(idea, best)
  const lastUnit = vs?.last.unitLabel ?? unit
  const lastFig = vs && (vs.units > 1 ? (lastUnit ? figureText(vs.then, lastUnit) : `${eurTight(vs.then)} each`) : eurTight(vs.last.paid))
  const hint = freeDeliveryHint(idea, best)
  const bulk = bulkText(best)
  // A cheaper price seen only in search gets one quiet line, never the slip.
  const cheaper = offersOf(idea)
    .filter((o) => o.offer?.group === 'exact' && !o.suppliers[0]?.checked)
    .map((o) => ({ o, fig: figureOf(o, unit, qty) }))
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
        {bulk && <p className="trust">{bulk}</p>}
        <ul className="qlines">
          {each !== null && items !== null && (
            <li>
              <Leader fig={eurTight(items)}>
                {qty > 1 ? `${qty} × ${eurTight(each)}` : f.packs > 1 || unit ? packText(f.packs, idea, 'Price') : 'Price'}
              </Leader>
            </li>
          )}
          <li>
            <Leader fig={deliveryFig(f, items)}>
              <DeliveryButton offer={best} onDelivery={onDelivery} />
            </Leader>
          </li>
        </ul>
        {hint && <p className="trust">{hint}</p>}
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
                  You pay{qty > 1 && ` for ${qty}`}
                  <br />
                  {f.delivered === null ? 'without delivery' : 'delivery included'}
                  {qty > 1 && f.perUnit !== null && (
                    <>
                      <br />
                      {eurTight(f.perUnit)} each
                    </>
                  )}
                </>
              )}
            </span>
            <span className="big">
              {eurTight(fig)}
              {unit && <small>/{unit}</small>}
            </span>
          </div>
        )}
        <PartnerNote partner={best.suppliers[0]?.partner} pay={pay} />
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
