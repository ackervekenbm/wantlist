import { useEffect, useId, useRef, useState } from 'react'
import type { PickPatch, Reaction } from '../../types'
import { REASON_MAX } from '../../types/limits'

interface Props {
  title: string
  reaction: Reaction | null
  reason: string | null
  onReact: (patch: PickPatch) => Promise<void>
}

const CHOICES: Array<{ value: Reaction; glyph: string; name: string }> = [
  { value: 'no', glyph: '✕', name: 'No way' },
  { value: 'maybe', glyph: '~', name: 'Kind of' },
  { value: 'yes', glyph: '♥', name: 'Yes' },
]

/** No way / Kind of / Yes on a pick, plus why not. Tapping the active one clears it. */
export function ReactionBar({ title, reaction, reason, onReact }: Props) {
  // Focus the why-not box only right after the user taps No way.
  const [focusWhy, setFocusWhy] = useState(false)

  return (
    <div className="react">
      <div className="react-choices" role="group" aria-label={`Your reaction to ${title}`}>
        {CHOICES.map(({ value, glyph, name }) => {
          const active = reaction === value
          return (
            <button
              key={value}
              type="button"
              className={`react-btn react-${value}`}
              aria-pressed={active}
              onClick={() => {
                setFocusWhy(!active && value === 'no')
                // A failure shows in the app's banner and rolls back.
                onReact(active ? { reaction: null, reason: null } : { reaction: value }).catch(() => {})
              }}
            >
              <span aria-hidden="true">{glyph}</span>
              <span>{name}</span>
            </button>
          )
        })}
      </div>
      {reaction === 'no' && <WhyNot title={title} reason={reason} autoFocus={focusWhy} onReact={onReact} />}
    </div>
  )
}

function WhyNot({
  title,
  reason,
  autoFocus,
  onReact,
}: {
  title: string
  reason: string | null
  autoFocus: boolean
  onReact: (patch: PickPatch) => Promise<void>
}) {
  const [value, setValue] = useState(reason ?? '')
  const id = useId()
  const lastSent = useRef(reason)

  const send = () => {
    const next = value.trim() || null
    if (next === lastSent.current) return
    const before = lastSent.current
    lastSent.current = next
    onReact({ reason: next }).catch(() => {
      lastSent.current = before
    })
  }
  // Unmounting (collapse, a new round) still saves what was typed.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })
  useEffect(() => () => sendRef.current(), [])

  return (
    <div className="react-why">
      <label htmlFor={id} className="visually-hidden">
        Why not {title}?
      </label>
      <input
        id={id}
        className="input react-why-input"
        placeholder="why not?"
        maxLength={REASON_MAX}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onBlur={send}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            send()
          }
        }}
      />
    </div>
  )
}
