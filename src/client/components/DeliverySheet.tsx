import { useId, useState, type FormEvent } from 'react'
import type { Pick } from '../../types'
import { deliveryText, eurTight } from '../lib/format'
import { Sheet } from './Sheet'

interface Props {
  /** The offer whose delivery you checked; null keeps the sheet closed. */
  offer: Pick | null
  onClose: () => void
  /** Euros (0 = free), or null for what the shop page said. */
  onSave: (cost: number | null) => Promise<void>
}

/** "Delivery from <shop>": what the cart says delivery costs, for this one offer. */
export function DeliverySheet({ offer, onClose, onSave }: Props) {
  return (
    <Sheet open={offer !== null} onClose={onClose} title={`Delivery from ${offer?.shop ?? 'the shop'}`}>
      {offer?.offer && <DeliveryForm key={offer.id} offer={offer} onClose={onClose} onSave={onSave} />}
    </Sheet>
  )
}

/** "4,95", "€ 4.95", "0": euros with at most two decimals; undefined when it isn't one. */
export function parseDelivery(raw: string): number | null | undefined {
  const s = raw.replace(/[€\s]/g, '').replace(',', '.')
  if (!s) return null
  return /^\d{1,4}(\.\d{1,2})?$/.test(s) ? Number(s) : undefined
}

function DeliveryForm({ offer, onClose, onSave }: Omit<Props, 'offer'> & { offer: Pick }) {
  const id = useId()
  const f = offer.offer!
  const own = f.foundDelivery ? f.delivery.cost ?? 0 : null
  const [cost, setCost] = useState(own === null ? '' : own.toFixed(2).replace('.', ','))
  const [busy, setBusy] = useState(false)
  const amount = parseDelivery(cost)
  const said = deliveryText(f.foundDelivery ?? f.delivery, offer.price)

  const save = async (value: number | null) => {
    setBusy(true)
    try {
      await onSave(value)
      onClose()
    } catch {
      // The hook shows why in the banner; the sheet stays open.
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (typeof amount === 'number' && !busy) void save(amount)
  }

  return (
    <form className="form" onSubmit={submit}>
      <p>
        {offer.shop}
        {offer.price !== null && ` · ${eurTight(offer.price)}`}
        <br />
        <span className="hint">The shop page said: {said}</span>
      </p>
      <div className="form-field">
        <label htmlFor={`${id}-cost`} className="form-label">
          Delivery cost to you, in € (0 = free)
        </label>
        <input
          id={`${id}-cost`}
          className="input"
          inputMode="decimal"
          autoComplete="off"
          value={cost}
          aria-invalid={amount === undefined}
          onChange={(e) => setCost(e.target.value)}
        />
      </div>
      <div className="acts">
        {f.foundDelivery ? (
          <button type="button" className="btn quiet" onClick={() => void save(null)} disabled={busy}>
            Clear
          </button>
        ) : (
          <button type="button" className="btn quiet" onClick={onClose} disabled={busy}>
            Cancel
          </button>
        )}
        <button type="submit" className="btn primary" disabled={typeof amount !== 'number' || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}
