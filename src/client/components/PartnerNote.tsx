import type { PartnerOffer } from '../../types'
import { formatEur, percentText, shortDate } from '../lib/format'
import { ExternalIcon } from './icons'

interface Props {
  partner: PartnerOffer | null | undefined
  /** What you pay at the shop, delivery included when known. */
  pay: number | null
}

/** What a partner program gives back on this offer, and the link that makes the purchase count. */
export function PartnerNote({ partner, pay }: Props) {
  if (!partner) return null
  const varies = partner.percentMax > partner.percent
  const after = pay !== null && partner.saving !== null ? Math.round((pay - partner.saving) * 100) / 100 : null
  return (
    <p className="partner">
      {after !== null ? `≈ ${formatEur(after)}${varies ? ' or less' : ''} after ${partner.program}` : partner.program}
      {' · '}
      {percentText(partner.percent, partner.percentMax)} back
      {partner.scope ? ` on ${partner.scope.charAt(0).toLowerCase()}${partner.scope.slice(1)}` : varies ? ', depends on what you buy' : ''}
      {partner.until && `, until ${shortDate(partner.until)}`}{' '}
      <a className="linkish" href={partner.link} target="_blank" rel="noreferrer noopener">
        Open via {partner.program} <ExternalIcon />
      </a>
    </p>
  )
}
