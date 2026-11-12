import { useId, useState } from 'react'

interface Props {
  /** Reactions on the current round. */
  reactions: number
  /** Any pick in any round has a reaction. */
  anyReaction: boolean
  preferencesEdited: boolean
  onRefine: () => Promise<void>
}

/** Researches another round from your reactions and preference edits. */
export function RefineBar({ reactions, anyReaction, preferencesEdited, onRefine }: Props) {
  const [sending, setSending] = useState(false)
  const hintId = useId()
  const ready = anyReaction || preferencesEdited
  const label =
    reactions > 0
      ? `Refine with ${reactions} reaction${reactions === 1 ? '' : 's'}`
      : preferencesEdited
        ? 'Refine with your edits'
        : 'Refine'

  const refine = async () => {
    setSending(true)
    try {
      await onRefine()
    } catch {
      // The hook shows why in the banner.
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="refine">
      <button
        type="button"
        className="btn btn-primary refine-btn"
        disabled={!ready || sending}
        aria-describedby={ready ? undefined : hintId}
        onClick={() => void refine()}
      >
        {label}
      </button>
      {!ready && (
        <span id={hintId} className="refine-hint">
          react to a pick first
        </span>
      )}
    </div>
  )
}
