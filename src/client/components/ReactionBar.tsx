import { useEffect, useId, useRef, useState } from 'react'
import type { PickPatch, Reaction } from '../../types'
import { REASON_MAX } from '../../types/limits'
import { MaybeIcon, NoIcon, YesIcon } from './icons'

interface Props {
  title: string
  reaction: Reaction | null
  reason: string | null
  onReact: (patch: PickPatch) => Promise<void>
  /** In the deck: the why card gets Next, which saves and moves on. */
  onNext?: () => void
}

/** What each reaction is called, on the keycaps and wherever a reaction is shown. */
export const REACTION_LABEL: Record<Reaction, string> = { no: 'No way', maybe: 'Kind of', yes: 'Yes' }

const CHOICES: Array<{ value: Reaction; Icon: typeof NoIcon }> = [
  { value: 'no', Icon: NoIcon },
  { value: 'maybe', Icon: MaybeIcon },
  { value: 'yes', Icon: YesIcon },
]

/** No way and Kind of ask why; each reaction has its own question and quick answers. */
const WHY = {
  no: { ask: "What's off?", label: (t: string) => `Why not ${t}?`, quick: ['Too expensive', 'Not my style', 'Wrong type', 'Doubt the quality'] },
  maybe: {
    ask: "What's missing?",
    label: (t: string) => `What's missing from ${t}?`,
    quick: ['A bit too pricey', 'Almost my style', 'Missing a feature', 'Unsure of the quality'],
  },
}
type WhyReaction = keyof typeof WHY

/** No way / Kind of / Yes keycaps on a pick, plus why for No way and Kind of. Tapping the active one clears it. */
export function ReactionBar({ title, reaction, reason, onReact, onNext }: Props) {
  // Focus the why box only right after the user taps No way or Kind of.
  const [focusWhy, setFocusWhy] = useState(false)

  return (
    <div className="react">
      <div className="keys" role="group" aria-label={`Your reaction to ${title}`}>
        {CHOICES.map(({ value, Icon }) => {
          const active = reaction === value
          return (
            <button
              key={value}
              type="button"
              className={`key ${value}`}
              aria-pressed={active}
              onClick={() => {
                setFocusWhy(!active && value in WHY)
                // A failure shows in the app's banner and rolls back.
                onReact(active ? { reaction: null, reason: null } : { reaction: value }).catch(() => {})
              }}
            >
              <Icon />
              <span>{REACTION_LABEL[value]}</span>
            </button>
          )
        })}
      </div>
      {reaction && reaction in WHY && (
        // Keyed: switching No way ↔ Kind of drops the reason (server rule), so the box starts empty.
        <Why
          key={reaction}
          kind={reaction as WhyReaction}
          title={title}
          reason={reason}
          autoFocus={focusWhy}
          onReact={onReact}
          onNext={onNext}
        />
      )}
    </div>
  )
}

function Why({
  kind,
  title,
  reason,
  autoFocus,
  onReact,
  onNext,
}: {
  kind: WhyReaction
  title: string
  reason: string | null
  autoFocus: boolean
  onReact: (patch: PickPatch) => Promise<void>
  onNext?: () => void
}) {
  const [value, setValue] = useState(reason ?? '')
  const id = useId()
  const why = WHY[kind]
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
    <div className={`whynot ${kind}`} role="group" aria-labelledby={`${id}-q`}>
      <p id={`${id}-q`}>
        {why.ask} <span>Optional, it steers the next round.</span>
      </p>
      <div className="chips">
        {why.quick.map((text) => (
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
        <label htmlFor={id} className="sr">
          {why.label(title)}
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
