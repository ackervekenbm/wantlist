import { useEffect, useId, useRef, useState } from 'react'
import type { PickPatch, Reaction } from '../../types'
import { REASON_MAX } from '../../types/limits'
import { MaybeIcon, NoIcon, YesIcon } from './icons'

interface Props {
  title: string
  reaction: Reaction | null
  reason: string | null
  onReact: (patch: PickPatch) => Promise<void>
  /** In the deck: the why-not card gets Next, which saves and moves on. */
  onNext?: () => void
}

const CHOICES: Array<{ value: Reaction; Icon: typeof NoIcon; name: string }> = [
  { value: 'no', Icon: NoIcon, name: 'No way' },
  { value: 'maybe', Icon: MaybeIcon, name: 'Kind of' },
  { value: 'yes', Icon: YesIcon, name: 'Yes' },
]

const QUICK = ['Too expensive', 'Not my style', 'Wrong type', 'Doubt the quality']

/** No way / Kind of / Yes keycaps on a pick, plus why not. Tapping the active one clears it. */
export function ReactionBar({ title, reaction, reason, onReact, onNext }: Props) {
  // Focus the why-not box only right after the user taps No way.
  const [focusWhy, setFocusWhy] = useState(false)

  return (
    <div className="react">
      <div className="keys" role="group" aria-label={`Your reaction to ${title}`}>
        {CHOICES.map(({ value, Icon, name }) => {
          const active = reaction === value
          return (
            <button
              key={value}
              type="button"
              className={`key ${value}`}
              aria-pressed={active}
              onClick={() => {
                setFocusWhy(!active && value === 'no')
                // A failure shows in the app's banner and rolls back.
                onReact(active ? { reaction: null, reason: null } : { reaction: value }).catch(() => {})
              }}
            >
              <Icon />
              <span>{name}</span>
            </button>
          )
        })}
      </div>
      {reaction === 'no' && (
        <WhyNot title={title} reason={reason} autoFocus={focusWhy} onReact={onReact} onNext={onNext} />
      )}
    </div>
  )
}

function WhyNot({
  title,
  reason,
  autoFocus,
  onReact,
  onNext,
}: {
  title: string
  reason: string | null
  autoFocus: boolean
  onReact: (patch: PickPatch) => Promise<void>
  onNext?: () => void
}) {
  const [value, setValue] = useState(reason ?? '')
  const id = useId()
  const lastSent = useRef(reason)

  const send = (text = value) => {
    const next = text.trim() || null
    if (next === lastSent.current) return
    const before = lastSent.current
    lastSent.current = next
    onReact({ reason: next }).catch(() => {
      lastSent.current = before
    })
  }
  // Unmounting (a pip jump, a new round) still saves what was typed.
  const sendRef = useRef(send)
  useEffect(() => {
    sendRef.current = send
  })
  useEffect(() => () => sendRef.current(), [])

  return (
    <div className="whynot" role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`}>
        What's off? <span>Optional, it steers the next round.</span>
      </p>
      <div className="chips">
        {QUICK.map((text) => (
          <button
            key={text}
            type="button"
            className="chipbtn"
            // Keeps focus in the input, so its blur doesn't save the typed text before the chip text.
            onMouseDown={(e) => e.preventDefault()}
            aria-pressed={value.trim() === text}
            onClick={() => {
              setValue(text)
              send(text)
            }}
          >
            {text}
          </button>
        ))}
      </div>
      <div className="wrow">
        <label htmlFor={id} className="visually-hidden">
          Why not {title}?
        </label>
        <input
          id={id}
          placeholder="In your words…"
          maxLength={REASON_MAX}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => send()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              send()
            }
          }}
        />
        {onNext && (
          <button
            type="button"
            className="btn small"
            onClick={() => {
              send()
              onNext()
            }}
          >
            Next
          </button>
        )}
      </div>
    </div>
  )
}
