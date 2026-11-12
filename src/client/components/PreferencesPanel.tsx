import { useId, useState, type FormEvent } from 'react'
import type { Preferences } from '../../types'
import { PREF_ITEM_CHARS, PREF_ITEMS_MAX } from '../../types/limits'

interface Props {
  preferences: Preferences
  /** False while a round is queued or running. */
  editable: boolean
  onSave: (preferences: Preferences) => Promise<void>
}

type ListKey = 'mustHaves' | 'avoid' | 'likes'

const LISTS: Array<{ key: ListKey; glyph: string; spoken: string; label: string }> = [
  { key: 'mustHaves', glyph: '✓', spoken: 'must have', label: 'Must have, one per line' },
  { key: 'avoid', glyph: '✗', spoken: 'avoid', label: 'Avoid, one per line' },
  { key: 'likes', glyph: '♥', spoken: 'liked', label: 'Liked, one per line' },
]

/** What the research learned you want; editable as one item per line. */
export function PreferencesPanel({ preferences, editable, onSave }: Props) {
  // Copied from props only when edit is pressed, so a poll can't wipe it.
  const [draft, setDraft] = useState<Record<ListKey, string> | null>(null)
  const [saving, setSaving] = useState(false)
  const id = useId()
  const hintId = `${id}-hint`
  const hint = !editable && (
    <span id={hintId} className="prefs-hint">
      round in progress
    </span>
  )

  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!draft || saving || !editable) return
    setSaving(true)
    try {
      await onSave({
        summary: preferences.summary,
        mustHaves: toItems(draft.mustHaves),
        avoid: toItems(draft.avoid),
        likes: toItems(draft.likes),
      })
      setDraft(null)
    } catch {
      // The hook shows why in the banner; the draft stays.
    } finally {
      setSaving(false)
    }
  }

  if (draft) {
    return (
      <form className="prefs prefs-edit" onSubmit={save}>
        {LISTS.map(({ key, label }) => (
          <div key={key} className="prefs-field">
            <label htmlFor={`${id}-${key}`} className="form-label">
              {label}
            </label>
            <textarea
              id={`${id}-${key}`}
              className="input"
              rows={3}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
            />
          </div>
        ))}
        <div className="prefs-bar">
          {hint}
          <button type="button" className="btn-text" onClick={() => setDraft(null)} disabled={saving}>
            cancel
          </button>
          <button
            type="submit"
            className="btn btn-primary"
            disabled={!editable || saving}
            aria-describedby={editable ? undefined : hintId}
          >
            Save
          </button>
        </div>
      </form>
    )
  }

  return (
    <section className="prefs" aria-label="What you want">
      {preferences.summary && <p className="prefs-summary">{preferences.summary}</p>}
      <ul className="prefs-chips" aria-label="Preferences">
        {LISTS.flatMap(({ key, glyph, spoken }) =>
          preferences[key].map((item) => (
            <li key={`${key}-${item}`} className={`prefs-chip prefs-chip-${key}`}>
              <span aria-hidden="true">{glyph} </span>
              <span className="visually-hidden">{spoken}: </span>
              {item}
            </li>
          )),
        )}
      </ul>
      <div className="prefs-bar">
        <button
          type="button"
          className="btn-text"
          disabled={!editable}
          aria-describedby={editable ? undefined : hintId}
          onClick={() =>
            setDraft({
              mustHaves: preferences.mustHaves.join('\n'),
              avoid: preferences.avoid.join('\n'),
              likes: preferences.likes.join('\n'),
            })
          }
        >
          edit preferences
        </button>
        {hint}
      </div>
    </section>
  )
}

function toItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().slice(0, PREF_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, PREF_ITEMS_MAX)
}
