import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Idea } from '../../types'
import { TITLE_MAX } from '../../types/limits'
import { shownTitle } from '../lib/triage'
import { PencilIcon } from './icons'

interface Props {
  idea: Idea
  onRename: (title: string | null) => Promise<void>
}

/** The screen's h1 with a rename button beside it. Clearing it hands naming back to the model. */
export function IdeaTitle({ idea, onRename }: Props) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const renameRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef(false)
  const inputId = useId()
  const title = shownTitle(idea)

  useEffect(() => {
    if (!editing && returnFocus.current) {
      returnFocus.current = false
      renameRef.current?.focus()
    }
  }, [editing])

  const close = () => {
    returnFocus.current = true
    setEditing(false)
  }

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await onRename(draft.trim() || null)
      close()
    } catch {
      // The hook shows why in the banner; the typed title stays.
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="title-row">
      {/* The route focuses this h1, so it stays while renaming, hidden behind the form. */}
      <h1 tabIndex={-1} className={editing ? 'sr' : undefined}>
        {title}
      </h1>
      {editing ? (
        <form className="title-form" onSubmit={save}>
          <label htmlFor={inputId} className="sr">
            Title
          </label>
          <input
            id={inputId}
            className="title-input"
            maxLength={TITLE_MAX}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
            }}
          />
          <span className="title-acts">
            <button type="button" className="btn small quiet" onClick={close} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn small primary" disabled={saving}>
              Save
            </button>
          </span>
        </form>
      ) : (
        idea.round > 0 && (
          <button
            ref={renameRef}
            type="button"
            className="iconbtn rename"
            aria-label="Rename"
            title="Rename"
            onClick={() => {
              setDraft(title)
              setEditing(true)
            }}
          >
            <PencilIcon width={18} height={18} />
          </button>
        )
      )}
    </div>
  )
}
