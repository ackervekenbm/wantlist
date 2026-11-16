import { useId, useState, type FormEvent } from 'react'
import type { Idea, NewPurchase, Pick } from '../../types'
import { packText } from '../lib/hunt'
import { parseBudget } from './IdeaForm'
import { Sheet } from './Sheet'

interface Props {
  idea: Idea
  /** The offer bought; null keeps the sheet closed. */
  offer: Pick | null
  onClose: () => void
  onSave: (input: NewPurchase) => Promise<void>
}

/** "Bought at <shop>": what you paid, and whether it is a refill (pre-set from the guess). */
export function BoughtSheet({ idea, offer, onClose, onSave }: Props) {
  return (
    <Sheet open={offer !== null} onClose={onClose} title={`Bought at ${offer?.shop ?? 'the shop'}`}>
      {offer && <BoughtForm key={offer.id} idea={idea} offer={offer} onClose={onClose} onSave={onSave} />}
    </Sheet>
  )
}

function BoughtForm({ idea, offer, onClose, onSave }: Props & { offer: Pick }) {
  const id = useId()
  const pay = offer.offer?.delivered ?? offer.price
  const [paid, setPaid] = useState(pay === null ? '' : pay.toFixed(2).replace('.', ','))
  const [refill, setRefill] = useState(idea.refill)
  const [busy, setBusy] = useState(false)
  const amount = parseBudget(paid)
  const ok = typeof amount === 'number' && refill !== null && !busy
  // packText already names the variant.
  const what = [offer.offer && packText(offer.offer.packs, idea, ''), idea.target?.product]

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok || typeof amount !== 'number' || refill === null) return
    setBusy(true)
    try {
      await onSave({ pickId: offer.id, paid: amount, refill })
      onClose()
    } catch {
      // The hook shows why in the banner; the sheet stays open.
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={save}>
      <p>{what.filter(Boolean).join(' · ') || offer.title}</p>
      <div className="form-field">
        <label htmlFor={`${id}-paid`} className="form-label">
          You paid, in € incl. delivery
        </label>
        <input
          id={`${id}-paid`}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={paid}
          aria-invalid={amount === undefined}
          onChange={(e) => setPaid(e.target.value)}
        />
      </div>
      <div role="group" aria-labelledby={`${id}-q`}>
        <p id={`${id}-q`} className="ask">
          Will you buy this again?
        </p>
        {idea.refill !== null && (
          <p className="hint">My guess: {idea.refill ? 'yes, it runs out' : 'no, a one-off buy'}. Change it if I'm wrong.</p>
        )}
        <div className="choice">
          <button type="button" className="key" aria-pressed={refill === true} onClick={() => setRefill(true)}>
            Yes, it's a refill
            <small>Keep in Pantry, wake on Running low</small>
          </button>
          <button type="button" className="key" aria-pressed={refill === false} onClick={() => setRefill(false)}>
            No, one-off
            <small>Move to Bought</small>
          </button>
        </div>
      </div>
      <div className="acts">
        <button type="button" className="btn quiet" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="btn primary" disabled={!ok}>
          {busy ? 'Saving…' : 'Save purchase'}
        </button>
      </div>
    </form>
  )
}
