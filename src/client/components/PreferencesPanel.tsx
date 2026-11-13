import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import type { Preferences } from '../../types'
import { PREF_ITEM_CHARS, PREF_ITEMS_MAX } from '../../types/limits'
import { Section } from './Leader'

interface Props {
  preferences: Preferences
  /** False while a round is queued or running. */
  editable: boolean
  onSave: (preferences: Preferences) => Promise<void>
  /** Bump to open the editor and scroll to it (Loosen a criterion); an open draft is kept. */
  editRequest?: number
}

type ListKey = 'mustHaves' | 'avoid' | 'likes'
type Draft = Record<ListKey, string>

const LISTS: Array<{ key: ListKey; glyph: string; cls: string; spoken: string; label: string }> = [
  { key: 'mustHaves', glyph: '✓', cls: 'must', spoken: 'must have', label: 'Must have, one per line' },
  { key: 'avoid', glyph: '✗', cls: 'avoid', spoken: 'avoid', label: 'Avoid, one per line' },
  { key: 'likes', glyph: '♥', cls: 'like', spoken: 'liked', label: 'Liked, one per line' },
]

const draftOf = (p: Preferences): Draft => ({
  mustHaves: p.mustHaves.join('\n'),
  avoid: p.avoid.join('\n'),
  likes: p.likes.join('\n'),
})

/** What I've learned: the summary and ✓ / ✗ / ♥ rows, editable as one item per line. */
export function PreferencesPanel({ preferences, editable, onSave, editRequest = 0 }: Props) {
  // Copied from props only when editing starts, so a poll can't wipe it.
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [request, setRequest] = useState(editRequest)
  const ref = useRef<HTMLElement>(null)
  const id = useId()
  const hintId = `${id}-hint`

  if (editRequest !== request) {
    setRequest(editRequest)
    if (editRequest > 0) setDraft((d) => d ?? draftOf(preferences))
  }
  useEffect(() => {
    if (editRequest <= 0) return
    ref.current?.scrollIntoView({ block: 'start' })
    ref.current?.querySelector('textarea')?.focus({ preventScroll: true })
  }, [editRequest])

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

  const lock = !editable && (
    <p id={hintId} className="lock">
      Locked while the next round researches.
    </p>
  )

  return (
    <Section className="panel" title="What I've learned" ref={ref}>
      <div className="card">
        {draft ? (
          <form className="prefs-edit" onSubmit={save}>
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
            {lock}
            <div className="prefs-bar">
              <button type="button" className="btn small quiet" onClick={() => setDraft(null)} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn small primary"
                disabled={!editable || saving}
                aria-describedby={editable ? undefined : hintId}
              >
                Save
              </button>
            </div>
          </form>
        ) : (
          <>
            {preferences.summary && <p className="lsum">{preferences.summary}</p>}
            <ul className="prefs" aria-label="Preferences">
              {LISTS.flatMap(({ key, glyph, cls, spoken }) =>
                preferences[key].map((item) => (
                  <li key={`${key}-${item}`} className="pref">
                    <span className={`g ${cls}`} aria-hidden="true">
                      {glyph}
                    </span>
                    <span>
                      <span className="sr">{spoken}: </span>
                      {item}
                    </span>
                  </li>
                )),
              )}
            </ul>
            {lock}
            <div className="prefs-bar">
              <button
                type="button"
                className="btn small"
                disabled={!editable}
                aria-describedby={editable ? undefined : hintId}
                onClick={() => setDraft(draftOf(preferences))}
              >
                Edit preferences
              </button>
            </div>
          </>
        )}
      </div>
    </Section>
  )
}

function toItems(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim().slice(0, PREF_ITEM_CHARS))
    .filter(Boolean)
    .slice(0, PREF_ITEMS_MAX)
}
