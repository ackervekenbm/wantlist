import { useId, useState } from 'react'

interface Props {
  /** Reactions on the current round. */
  reactions: number
  /** The current round's number. */
  round: number
  /** Any pick in any round has a reaction. */
  anyReaction: boolean
  preferencesEdited: boolean
  onRefine: () => Promise<void>
}

/** The sticky dock: researches another round from your reactions and preference edits. */
export function RefineBar({ reactions, round, anyReaction, preferencesEdited, onRefine }: Props) {
  const [sending, setSending] = useState(false)
  const whyId = useId()
  const ready = anyReaction || preferencesEdited
  const label = reactions > 0 ? `Refine with ${reactions}` : preferencesEdited ? 'Refine with your edits' : 'Refine'
  const why = !ready
    ? 'React to a pick to refine.'
    : reactions > 0
      ? `${reactions} reaction${reactions === 1 ? '' : 's'} will steer round ${round + 1}.`
      : `Your ${preferencesEdited ? 'edits' : 'reactions'} will steer round ${round + 1}.`

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
    <div className="dock">
      <p className="why" id={whyId}>
        {why}
      </p>
      <button
        type="button"
        className="btn primary"
        disabled={!ready || sending}
        aria-describedby={ready ? undefined : whyId}
        onClick={() => void refine()}
      >
        {label}
      </button>
    </div>
  )
}
