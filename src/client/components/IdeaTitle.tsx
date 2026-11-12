import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Idea } from '../../types'
import { TITLE_MAX } from '../../types/limits'

interface Props {
  idea: Idea
  onRename: (title: string | null) => Promise<void>
}

/** The title an idea card shows: the model's (or yours) once researched, else what you typed. */
export function shownTitle(idea: Idea): string {
  return idea.round > 0 ? (idea.title ?? idea.text) : idea.text
}

/** The title with renaming, for inside the screen's h1. Clearing it hands naming back to the model. */
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

  if (editing) {
    return (
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
    )
  }

  return (
    <>
      {title}
      {idea.round > 0 && (
        <>
          {' '}
          <button
            ref={renameRef}
            type="button"
            className="linkish rename"
            onClick={() => {
              setDraft(title)
              setEditing(true)
            }}
          >
            rename
          </button>
        </>
      )}
    </>
  )
}
