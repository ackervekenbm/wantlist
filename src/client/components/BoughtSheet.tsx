import { useId, useState, type FormEvent } from 'react'
import type { Idea, NewPurchase, Pick } from '../../types'
import { deliveredPrice, freeDeliveryAt, priceEach } from '../../types/bulk'
import { QUANTITY_MAX } from '../../types/limits'
import { packText, quantityOf } from '../lib/hunt'
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
  const f = offer.offer
  // The quantity the owner set, else the one that makes delivery free.
  const start = idea.target?.quantity ?? (f && freeDeliveryAt(offer.price, f.delivery, f.bulk)?.qty) ?? 1
  const [count, setCount] = useState(String(start))
  const n = Number(count)
  const qty = Number.isInteger(n) && n >= 1 && n <= QUANTITY_MAX ? n : null
  // What that many cost with delivery, until the owner types what they paid.
  const items = qty === null || offer.price === null ? null : priceEach(offer.price, f?.bulk, qty) * qty
  const ranked = qty === quantityOf(idea) ? f?.delivered : null // the total the hunt already worked out
  const pay = ranked ?? (items === null ? null : f ? (deliveredPrice(items, f.delivery) ?? items) : items)
  const [typed, setTyped] = useState<string | null>(null)
  const paid = typed ?? (pay === null ? '' : pay.toFixed(2).replace('.', ','))
  const [refill, setRefill] = useState(idea.refill)
  const [busy, setBusy] = useState(false)
  const amount = parseBudget(paid)
  const ok = typeof amount === 'number' && qty !== null && refill !== null && !busy
  // packText already names the variant.
  const what = [f && packText(f.packs, idea, ''), idea.target?.product]

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!ok || typeof amount !== 'number' || refill === null) return
    setBusy(true)
    try {
      await onSave({ pickId: offer.id, quantity: qty ?? 1, paid: amount, refill })
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
        <label htmlFor={`${id}-qty`} className="form-label">
          How many you bought
        </label>
        <input
          id={`${id}-qty`}
          className="input"
          inputMode="numeric"
          autoComplete="off"
          value={count}
          aria-invalid={qty === null}
          onChange={(e) => setCount(e.target.value)}
        />
      </div>
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
          onChange={(e) => setTyped(e.target.value)}
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
