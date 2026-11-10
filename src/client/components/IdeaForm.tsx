import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { NewIdea } from '../../types'

/** Mirrors the server's limits (src/server/app.ts). */
export const MAX_TEXT = 500
export const MAX_NOTES = 500

interface Props {
  initial?: Partial<NewIdea>
  submitLabel: string
  /** A second submit button (e.g. "Save & research again"); passes `true`. */
  secondaryLabel?: string
  /** Capture mode: one line up front, budget and notes behind a toggle. */
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
  const [showDetails, setShowDetails] = useState(!compact || !!initial?.budget || !!initial?.notes)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { text: useId(), budget: useId(), notes: useId() }

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

  return (
    <form className={compact ? 'form form-capture' : 'form'} onSubmit={onFormSubmit}>
      <label htmlFor={ids.text} className={compact ? 'visually-hidden' : 'form-label'}>
        What do you want?
      </label>
      <textarea
        id={ids.text}
        className="input input-text"
        rows={compact ? 2 : 2}
        maxLength={MAX_TEXT}
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={submitOnEnter}
      />

      {showDetails && (
        <div className="form-details">
          <div className="form-field form-field-budget">
            <label htmlFor={ids.budget} className="form-label">
              Budget <span className="form-hint">(max €, optional)</span>
            </label>
            <input
              id={ids.budget}
              className="input"
              inputMode="decimal"
              autoComplete="off"
              value={budget}
              placeholder="150"
              aria-invalid={invalidBudget}
              onChange={(e) => setBudget(e.target.value)}
            />
          </div>
          <div className="form-field form-field-notes">
            <label htmlFor={ids.notes} className="form-label">
              Must-haves <span className="form-hint">(optional)</span>
            </label>
            <input
              id={ids.notes}
              className="input"
              maxLength={MAX_NOTES}
              value={notes}
              placeholder="e.g. quiet, white, fits a small flat"
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {invalidBudget && <p className="form-error">Budget should be an amount in euros, like 150 or 89,99.</p>}

      <div className="form-bar">
        {compact && !showDetails ? (
          <button type="button" className="btn-text" onClick={() => setShowDetails(true)}>
            + budget &amp; must-haves
          </button>
        ) : (
          <span className="form-hint">{compact ? 'Enter to add · research runs in the background' : ''}</span>
        )}
        <div className="form-buttons">
          {onCancel && (
            <button type="button" className="btn-text" onClick={onCancel} disabled={busy}>
              cancel
            </button>
          )}
          {secondaryLabel && (
            <button type="button" className="btn btn-secondary" disabled={!canSubmit} onClick={() => void submit(true)}>
              {secondaryLabel}
            </button>
          )}
          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {busy ? 'Saving…' : submitLabel}
          </button>
        </div>
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
