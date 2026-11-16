import type { Idea, Pick } from '../../types'
import { deliveryText, eurTight } from '../lib/format'
import { figureOf, packText } from '../lib/hunt'
import { ChevronIcon, ExternalIcon } from './icons'
import { Leader, Section } from './Leader'
import { figureText, STOCK } from './OfferSlip'

interface Props {
  idea: Idea
  /** The newest hunt's offers without the best one, in rank order. */
  offers: Pick[]
  unit: string | null
  onBought: (offer: Pick) => void
}

/** Other shops selling exactly this, then two folded groups: can't be delivered here, and not the exact product. */
export function OfferList({ idea, offers, unit, onBought }: Props) {
  const exact = offers.filter((o) => o.offer?.group === 'exact')
  const away = offers.filter((o) => o.offer?.group === 'unavailable')
  const off = offers.filter((o) => o.offer?.group === 'mismatch')
  if (offers.length === 0) return null
  return (
    <Section className="panel" title="Other shops" count={exact.length} note={unit ? `per ${unit}, delivery in` : 'price, delivery in'}>
      {exact.length > 0 && (
        <ul className="card offers" aria-label="Other shops">
          {exact.map((o) => (
            <OfferRow key={o.id} idea={idea} offer={o} unit={unit} onBought={onBought} />
          ))}
        </ul>
      )}
      <Fold title="Pick-up only or no delivery to Belgium" idea={idea} offers={away} unit={unit} />
      <Fold title="Not the exact product" idea={idea} offers={off} unit={unit} />
    </Section>
  )
}

function OfferRow({ idea, offer, unit, onBought }: { idea: Idea; offer: Pick; unit: string | null; onBought?: (offer: Pick) => void }) {
  const f = offer.offer
  const s = offer.suppliers[0]
  const fig = figureOf(offer, unit)
  const apart = f?.group === 'unavailable' || f?.group === 'mismatch'
  const sub = apart
    ? [f.mismatch ?? deliveryText(f.delivery, offer.price)]
    : [
        unit && f && offer.price !== null ? `${packText(f.packs, idea, '')} ${eurTight(offer.price)}`.trim() : null,
        f?.delivered === null ? 'delivery not shown' : null,
        s ? STOCK[s.availability].toLowerCase() : null,
        f?.sellerNote,
        s?.checked ? null : 'search price',
      ].filter(Boolean)
  return (
    <li className={`off${s?.availability === 'out_of_stock' ? ' sold' : ''}`}>
      <Leader fig={fig === null ? '–' : figureText(fig, unit)}>{offer.shop}</Leader>
      <p className="osub">
        {apart ? <span className="flag">{sub[0]}</span> : <>{s?.checked ? <span className="ok">✓</span> : '≈'} {sub.join(' · ')}</>}
      </p>
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

function Fold({ title, idea, offers, unit }: { title: string; idea: Idea; offers: Pick[]; unit: string | null }) {
  if (offers.length === 0) return null
  return (
    <details className="card apart">
      <summary>
        {title} <span className="n">{offers.length}</span>
        <ChevronIcon className="chev" />
      </summary>
      <ul className="offers" aria-label={title}>
        {offers.map((o) => (
          <OfferRow key={o.id} idea={idea} offer={o} unit={unit} />
        ))}
      </ul>
    </details>
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
