import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Idea } from '../../types'
import { TITLE_MAX } from '../../types/limits'
import { ChevronIcon } from './icons'

interface Props {
  idea: Idea
  collapsed: boolean
  onToggle: () => void
  bodyId: string
  onRename: (title: string | null) => Promise<void>
}

/** The title an idea card shows: the model's (or yours) once researched, else what you typed. */
export function shownTitle(idea: Idea): string {
  return idea.round > 0 ? (idea.title ?? idea.text) : idea.text
}

/** The collapse toggle (title only), the original words, and renaming. */
export function IdeaTitle({ idea, collapsed, onToggle, bodyId, onRename }: Props) {
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
    <div className="title">
      {editing ? (
        <form className="title-form" onSubmit={save}>
          <label htmlFor={inputId} className="visually-hidden">
            Card title
          </label>
          <input
            id={inputId}
            className="input title-input"
            maxLength={TITLE_MAX}
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') close()
            }}
          />
          <button type="submit" className="btn btn-primary" disabled={saving}>
            Save
          </button>
          <button type="button" className="btn-text" onClick={close} disabled={saving}>
            cancel
          </button>
        </form>
      ) : (
        <button type="button" className="idea-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={onToggle}>
          <h3 className="idea-text">{title}</h3>
          <ChevronIcon className={collapsed ? 'chevron' : 'chevron chevron-open'} />
        </button>
      )}
      <div className="title-sub">
        {title !== idea.text && <span className="title-asked">you asked: {idea.text}</span>}
        {!editing && idea.round > 0 && (
          <button
            ref={renameRef}
            type="button"
            className="btn-text"
            onClick={() => {
              setDraft(title)
              setEditing(true)
            }}
          >
            rename
          </button>
        )}
      </div>
    </div>
  )
}
