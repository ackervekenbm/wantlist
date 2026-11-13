import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { NewIdea } from '../../types'

/** Mirrors the server's limits (src/server/app.ts). */
const MAX_TEXT = 500
const MAX_NOTES = 500

interface Props {
  initial?: Partial<NewIdea>
  submitLabel: string
  /** A second submit button (e.g. "Save & research again"); passes `true`. */
  secondaryLabel?: string
  /** Capture mode (home): one line and Add, budget and notes behind a toggle. */
  compact?: boolean
  placeholder?: string
  onSubmit: (idea: NewIdea, secondary: boolean) => Promise<void>
  onCancel?: () => void
}

/**
 * Text, budget and notes for an idea. Enter submits, Shift+Enter starts a new
 * line. The form keeps its values when submitting fails, and shows why.
 */
export function IdeaForm({ initial, submitLabel, secondaryLabel, compact, placeholder, onSubmit, onCancel }: Props) {
  const [text, setText] = useState(initial?.text ?? '')
  const [budget, setBudget] = useState(initial?.budget != null ? String(initial.budget) : '')
  const [notes, setNotes] = useState(initial?.notes ?? '')
  const [showDetails, setShowDetails] = useState(!!initial?.budget || !!initial?.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { text: useId(), budget: useId(), notes: useId() }

  const hasDetails = !!budget.trim() || !!notes.trim()
  const parsedBudget = parseBudget(budget)
  const invalidBudget = parsedBudget === undefined
  const canSubmit = !!text.trim() && !invalidBudget && !busy

  const submit = async (secondary: boolean) => {
    if (!canSubmit) return
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ text: text.trim(), budget: parsedBudget ?? null, notes: notes.trim() || null }, secondary)
      if (compact) {
        setText('')
        setBudget('')
        setNotes('')
        setShowDetails(false)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onFormSubmit = (e: FormEvent) => {
    e.preventDefault()
    void submit(false)
  }

  const submitOnEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void submit(false)
    }
  }

  const textarea = (
    <textarea
      id={ids.text}
      className={compact ? undefined : 'input input-text'}
      rows={compact ? 1 : 2}
      maxLength={MAX_TEXT}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={submitOnEnter}
    />
  )
  const submitButton = (
    <button className="btn primary" type="submit" disabled={!canSubmit}>
      {busy ? 'Saving…' : submitLabel}
    </button>
  )
  const errors = (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {invalidBudget && <p className="form-error">Budget should be an amount in euros, like 150 or 89,99.</p>}
    </>
  )

  if (compact) {
    return (
      <form className="capture" aria-label="Add an idea" autoComplete="off" onSubmit={onFormSubmit}>
        <label htmlFor={ids.text} className="sr">
          What do you want?
        </label>
        <div className="cap-row">
          {textarea}
          {submitButton}
        </div>
        {(showDetails || hasDetails) && (
          <div className="cap-extra">
            <label className="field">
              Budget
              <input
                inputMode="decimal"
                value={budget}
                placeholder="€ max"
                aria-invalid={invalidBudget}
                onChange={(e) => setBudget(e.target.value)}
              />
            </label>
            <label className="field">
              Notes
              <input
                maxLength={MAX_NOTES}
                value={notes}
                placeholder="size 36, no subscription…"
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
          </div>
        )}
        {errors}
        <div className="cap-more">
          {/* Filled-in details still count, so they can't be hidden. */}
          {hasDetails ? (
            <span />
          ) : (
            <button
              type="button"
              className="linkish"
              aria-expanded={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              {showDetails ? 'Hide budget & notes' : '+ Budget & notes'}
            </button>
          )}
          <span className="hint">Enter adds</span>
        </div>
      </form>
    )
  }

  return (
    <form className="form" onSubmit={onFormSubmit}>
      <label htmlFor={ids.text} className="form-label">
        What do you want?
      </label>
      {textarea}

      <div className="form-details">
        <div className="form-field">
          <label htmlFor={ids.budget} className="form-label">
            Budget
          </label>
          <input
            id={ids.budget}
            className="input"
            inputMode="decimal"
            autoComplete="off"
            value={budget}
            placeholder="€ max"
            aria-invalid={invalidBudget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <div className="form-field">
          <label htmlFor={ids.notes} className="form-label">
            Notes
          </label>
          <input
            id={ids.notes}
            className="input"
            maxLength={MAX_NOTES}
            value={notes}
            placeholder="size 36, no subscription…"
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
      </div>

      {errors}

      <div className="form-bar">
        {onCancel && (
          <button type="button" className="btn quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
        )}
        {secondaryLabel && (
          <button type="button" className="btn" disabled={!canSubmit} onClick={() => void submit(true)}>
            {secondaryLabel}
          </button>
        )}
        {submitButton}
      </div>
    </form>
  )
}

/** '' → null (no budget); a positive amount ("89,99", "€ 150") → number; anything else → undefined. */
export function parseBudget(raw: string): number | null | undefined {
  const s = raw.replace(/[€\s]/g, '').replace(',', '.')
  if (!s) return null
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined
  const n = Number(s)
  return n > 0 ? n : undefined
}
