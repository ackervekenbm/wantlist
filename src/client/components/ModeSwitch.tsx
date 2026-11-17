import type { IdeaMode } from '../../types'

interface Props {
  mode: IdeaMode
  /** While the idea is researched: the server refuses a switch then. */
  disabled: boolean
  onSwitch: (mode: IdeaMode) => void
}

const MODES: Array<[IdeaMode, string]> = [
  ['explore', 'Explore'],
  ['hunt', 'Hunt'],
]

/** Explore ⇄ Hunt, a segmented switch in the idea's top bar. */
export function ModeSwitch({ mode, disabled, onSwitch }: Props) {
  return (
    <div className="seg" role="group" aria-label="Mode">
      {MODES.map(([m, label]) => (
        <button
          key={m}
          type="button"
          aria-pressed={mode === m}
          disabled={disabled}
          onClick={() => {
            if (m !== mode) onSwitch(m)
          }}
        >
          {label}
        </button>
      ))}
    </div>
  )
}
