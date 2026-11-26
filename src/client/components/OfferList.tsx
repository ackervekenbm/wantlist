import type { Idea, OfferFacts, Pick } from '../../types'
import { deliveryText, eurTight } from '../lib/format'
import { priceEach } from '../../types/bulk'
import { bulkText, figureOf, freeDeliveryHint, packText, quantityOf } from '../lib/hunt'
import { ChevronIcon, ExternalIcon } from './icons'
import { Leader, Section } from './Leader'
import { figureText, STOCK } from './OfferSlip'
import { PartnerNote } from './PartnerNote'

interface Props {
  idea: Idea
  /** The newest hunt's offers without the best one, in rank order. */
  offers: Pick[]
  unit: string | null
  onBought: (offer: Pick) => void
  /** Opens the sheet for what delivery costs you. */
  onDelivery: (offer: Pick) => void
}

/** Other shops selling exactly this, then two folded groups: can't be delivered here, and not the exact product. */
export function OfferList({ idea, offers, unit, onBought, onDelivery }: Props) {
  const exact = offers.filter((o) => o.offer?.group === 'exact')
  const away = offers.filter((o) => o.offer?.group === 'unavailable')
  const off = offers.filter((o) => o.offer?.group === 'mismatch')
  if (offers.length === 0) return null
  return (
    <Section className="panel" title="Other shops" count={exact.length} note={unit ? `per ${unit}, delivery in` : 'price, delivery in'}>
      {exact.length > 0 && (
        <ul className="card offers" aria-label="Other shops">
          {exact.map((o) => (
            <OfferRow key={o.id} idea={idea} offer={o} unit={unit} onBought={onBought} onDelivery={onDelivery} />
          ))}
        </ul>
      )}
      <Fold title="Pick-up only or no delivery to Belgium" idea={idea} offers={away} unit={unit} onDelivery={onDelivery} />
      <Fold title="Not the exact product" idea={idea} offers={off} unit={unit} />
    </Section>
  )
}

function OfferRow({
  idea,
  offer,
  unit,
  onBought,
  onDelivery,
}: {
  idea: Idea
  offer: Pick
  unit: string | null
  onBought?: (offer: Pick) => void
  onDelivery?: (offer: Pick) => void
}) {
  const f = offer.offer
  const s = offer.suppliers[0]
  const qty = quantityOf(idea)
  const each = offer.price === null ? null : priceEach(offer.price, f?.bulk, qty)
  const fig = figureOf(offer, unit, qty)
  const mismatch = f?.group === 'mismatch'
  const hint = mismatch ? null : freeDeliveryHint(idea, offer)
  const bulk = mismatch ? null : bulkText(offer)
  const sub = [
    qty > 1 && each !== null ? `${qty} × ${eurTight(each)}` : null,
    unit && f && offer.price !== null && qty === 1 ? `${packText(f.packs, idea, '')} ${eurTight(offer.price)}`.trim() : null,
    s ? STOCK[s.availability].toLowerCase() : null,
    f?.sellerNote,
  ].filter(Boolean)
  return (
    <li className={`off${s?.availability === 'out_of_stock' ? ' sold' : ''}`}>
      <Leader fig={fig === null ? '–' : figureText(fig, unit)}>{offer.shop}</Leader>
      <p className="osub">
        {mismatch ? (
          <span className="flag">{f.mismatch}</span>
        ) : (
          <>
            {s?.checked ? <span className="ok">✓ checked</span> : '≈ search price'}
            {sub.map((t) => ` · ${t}`)}
          </>
        )}
      </p>
      {f && (
        <p className="odel">
          <Leader fig={deliveryFig(f, each === null ? null : each * qty)}>{onDelivery ? <DeliveryButton offer={offer} onDelivery={onDelivery} /> : 'Delivery'}</Leader>
        </p>
      )}
      {(hint || bulk) && <p className="osub">{[hint, bulk].filter(Boolean).join(' · ')}</p>}
      {!mismatch && f?.group !== 'unavailable' && <PartnerNote partner={s?.partner} pay={f?.delivered ?? offer.price} />}
      <div className="erow-acts">
        <a className="linkish" href={offer.url} target="_blank" rel="noreferrer noopener">
          Open shop <ExternalIcon />
        </a>
        {onBought && (
          <button type="button" className="linkish" onClick={() => onBought(offer)}>
            Bought here
          </button>
        )}
      </div>
    </li>
  )
}

function Fold({ title, idea, offers, unit, onDelivery }: { title: string; idea: Idea; offers: Pick[]; unit: string | null; onDelivery?: (offer: Pick) => void }) {
  if (offers.length === 0) return null
  return (
    <details className="card apart">
      <summary>
        {title} <span className="n">{offers.length}</span>
        <ChevronIcon className="chev" />
      </summary>
      <ul className="offers" aria-label={title}>
        {offers.map((o) => (
          <OfferRow key={o.id} idea={idea} offer={o} unit={unit} onDelivery={onDelivery} />
        ))}
      </ul>
    </details>
  )
}

/** The figure on a Delivery line: "free", "€ 4,95", "not shown", "pick-up only"…, or your own cost with ", you checked". */
export function deliveryFig(f: OfferFacts, price: number | null): string {
  if (f.foundDelivery) return `${f.delivery.kind === 'free' ? 'free' : eurTight(f.delivery.cost ?? 0)}, you checked`
  if (f.delivery.kind === 'paid' && f.delivery.cost !== null) return eurTight(f.delivery.cost)
  return deliveryText(f.delivery, price).replace(/^delivery not shown$/, 'not shown')
}

/** "Delivery", named for its shop so each offer's button is told apart. */
export function DeliveryButton({ offer, onDelivery }: { offer: Pick; onDelivery: (offer: Pick) => void }) {
  return (
    <button type="button" className="linkish" aria-label={`Delivery at ${offer.shop}`} onClick={() => onDelivery(offer)}>
      Delivery
    </button>
  )
}

/** Offers of earlier hunts, shown in Explore: one closed block per hunt. */
export function EarlierHunts({ idea }: { idea: Idea }) {
  const offers = idea.picks.filter((p) => p.kind === 'offer')
  const rounds = [...new Set(offers.map((p) => p.round))]
  if (rounds.length === 0) return null
  return (
    <Section className="panel" title="Earlier hunts">
      {rounds.map((round) => {
        const these = offers.filter((p) => p.round === round)
        return (
          <details key={round} className="card apart">
            <summary>
              Hunt, round {round} <span className="n">{these.length}</span>
              <ChevronIcon className="chev" />
            </summary>
            <ul className="offers" aria-label={`Hunt, round ${round}`}>
              {these.map((o) => (
                <OfferRow key={o.id} idea={idea} offer={o} unit={null} />
              ))}
            </ul>
          </details>
        )
      })}
    </Section>
  )
}
