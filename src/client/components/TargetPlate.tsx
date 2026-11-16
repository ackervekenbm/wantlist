import { useId, useState, type FormEvent } from 'react'
import type { Condition, HuntTarget } from '../../types'
import { HuntIcon, PencilIcon } from './icons'
import { Sheet } from './Sheet'

interface Props {
  target: HuntTarget
  /** False while the hunt runs: the server refuses a target edit then. */
  editable: boolean
  /** Bump to open the editor (Loosen the target). */
  editRequest: number
  /** `again` also queues a new hunt. */
  onSave: (target: HuntTarget, again: boolean) => Promise<void>
}

const CONDITIONS: Array<[Condition, string]> = [
  ['new', 'New'],
  ['refurbished', 'Refurbished'],
  ['used', 'Used'],
  ['any', 'Any condition'],
]

/** "Not Optimum, not Classic." */
function exclusions(exclude: string[]): string {
  return exclude.length ? ` ${exclude.map((x, i) => `${i ? 'not' : 'Not'} ${x}`).join(', ')}.` : ''
}

/** What the hunt looks for: product · variant (· condition unless new), the exclusions underneath; tap to edit. */
export function TargetPlate({ target, editable, editRequest, onSave }: Props) {
  const [open, setOpen] = useState(false)
  const [request, setRequest] = useState(editRequest)
  if (editRequest !== request) {
    setRequest(editRequest)
    if (editRequest > 0 && editable) setOpen(true)
  }

  const name = [target.product, target.variant, target.condition === 'new' ? null : CONDITIONS.find(([c]) => c === target.condition)?.[1].toLowerCase()]
    .filter(Boolean)
    .join(' · ')
  const inner = (
    <>
      <span className="glyph hunt" aria-hidden="true">
        <HuntIcon />
      </span>
      <span className="plate-text">
        <span className="prod">{name}</span>
        <small>Exact match only.{exclusions(target.exclude)}</small>
      </span>
    </>
  )

  return (
    <>
      {editable ? (
        <button type="button" className="plate" onClick={() => setOpen(true)}>
          {inner}
          <PencilIcon className="plate-edit" />
          <span className="sr">Edit target</span>
        </button>
      ) : (
        <div className="plate">{inner}</div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="Edit target">
        <TargetForm
          target={target}
          onCancel={() => setOpen(false)}
          onSave={async (t, again) => {
            await onSave(t, again)
            setOpen(false)
          }}
        />
      </Sheet>
    </>
  )
}

function TargetForm({ target, onCancel, onSave }: { target: HuntTarget; onCancel: () => void; onSave: Props['onSave'] }) {
  const id = useId()
  const [product, setProduct] = useState(target.product)
  const [variant, setVariant] = useState(target.variant)
  const [condition, setCondition] = useState(target.condition)
  const [exclude, setExclude] = useState(target.exclude.join('\n'))
  const [busy, setBusy] = useState(false)
  const ok = !!product.trim() && !busy

  const save = async (again: boolean) => {
    if (!ok) return
    setBusy(true)
    try {
      const items = exclude.split('\n').map((s) => s.trim()).filter(Boolean)
      await onSave({ ...target, product: product.trim(), variant: variant.trim(), condition, exclude: items }, again)
    } catch {
      // The hook shows why in the banner; the sheet stays open.
      setBusy(false)
    }
  }
  const submit = (e: FormEvent) => {
    e.preventDefault()
    void save(false)
  }

  return (
    <form className="form" onSubmit={submit}>
      <div className="form-field">
        <label htmlFor={`${id}-p`} className="form-label">
          Product
        </label>
        <input id={`${id}-p`} className="input" maxLength={120} value={product} onChange={(e) => setProduct(e.target.value)} />
      </div>
      <div className="form-details">
        <div className="form-field">
          <label htmlFor={`${id}-c`} className="form-label">
            Condition
          </label>
          <select id={`${id}-c`} className="input" value={condition} onChange={(e) => setCondition(e.target.value as Condition)}>
            {CONDITIONS.map(([c, label]) => (
              <option key={c} value={c}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div className="form-field">
          <label htmlFor={`${id}-v`} className="form-label">
            Variant
          </label>
          <input
            id={`${id}-v`}
            className="input"
            maxLength={120}
            value={variant}
            placeholder="size, colour, pack…"
            onChange={(e) => setVariant(e.target.value)}
          />
        </div>
      </div>
      <div className="form-field">
        <label htmlFor={`${id}-x`} className="form-label">
          Not this, one per line
        </label>
        <textarea id={`${id}-x`} className="input" rows={3} value={exclude} onChange={(e) => setExclude(e.target.value)} />
      </div>
      <div className="form-bar">
        <button type="button" className="btn quiet" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn" disabled={!ok} onClick={() => void save(true)}>
          Save & hunt again
        </button>
        <button type="submit" className="btn primary" disabled={!ok}>
          Save
        </button>
      </div>
    </form>
  )
}
