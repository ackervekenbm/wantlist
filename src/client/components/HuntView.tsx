import { useState } from 'react'
import { isCovered, type Idea, type Pick as PickT } from '../../types'
import type { IdeasActions } from '../hooks/useIdeas'
import { bestOffer, exploreRounds, offersOf, unitOf } from '../lib/hunt'
import { BoughtSheet } from './BoughtSheet'
import { CoveredStub, YouPaid } from './CoveredStub'
import { DeliverySheet } from './DeliverySheet'
import { EarlierRounds } from './EarlierRounds'
import { OfferList } from './OfferList'
import { OfferSlip } from './OfferSlip'

interface Props {
  idea: Idea
  actions: Pick<IdeasActions, 'buy' | 'runningLow' | 'setDelivery'>
}

/** A hunt below its header and status: covered, or the best offer and the other shops; then what you paid and the Explore rounds, folded. */
export function HuntView({ idea, actions }: Props) {
  const [buying, setBuying] = useState<PickT | null>(null)
  const [delivering, setDelivering] = useState<PickT | null>(null)
  const best = bestOffer(idea)
  const unit = unitOf(idea)
  const wanted = idea.list === 'wanted'

  return (
    <>
      {isCovered(idea) && <CoveredStub idea={idea} onRunningLow={() => fire(actions.runningLow(idea.id))} />}
      {wanted && best && <OfferSlip idea={idea} best={best} unit={unit} onBought={setBuying} onDelivery={setDelivering} />}
      {wanted && <OfferList idea={idea} offers={offersOf(idea).filter((o) => o !== best)} unit={unit} onBought={setBuying} onDelivery={setDelivering} />}
      <YouPaid idea={idea} />
      <EarlierRounds picks={exploreRounds(idea)} />
      <DeliverySheet offer={delivering} onClose={() => setDelivering(null)} onSave={(cost) => actions.setDelivery(delivering!.id, cost)} />
      <BoughtSheet idea={idea} offer={buying} onClose={() => setBuying(null)} onSave={(input) => actions.buy(idea.id, input)} />
    </>
  )
}

/** The hook already shows a failed request in the app's error banner. */
function fire(p: Promise<void>): void {
  p.catch(() => {})
}
