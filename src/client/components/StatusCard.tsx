import { useId, type ReactNode } from 'react'
import type { Idea, ServerStatus } from '../../types'
import { RETRY_MAX_ATTEMPTS } from '../../types/limits'
import { clockTime } from '../lib/format'
import { quotaResetAt, stepOf } from '../lib/triage'

interface Props {
  idea: Idea
  status: ServerStatus | null
  onRerun: () => void
  /** Opens What I've learned for editing; absent when there is nothing learned yet. */
  onLoosen?: () => void
  onReword: () => void
}

/** Where research on a wanted idea stands, with the one thing you can do about it. Nothing when it's done. */
export function StatusCard({ idea, status, onRerun, onLoosen, onReword }: Props) {
  const next = idea.round + 1
  const off = status && !status.researchEnabled
  const reset = status && quotaResetAt(status)

  if (idea.status === 'error' && idea.errorKind === 'nothing-new') {
    return (
      <Card dot="warn" title="Nothing new found">
        {/* Only the exclusion failure means "seen it all"; the others (nothing to buy, nothing verified) carry their own advice. */}
        {idea.error?.startsWith('Nothing new found') ? (
          <p>
            Round {next} turned up only picks you've already seen.{' '}
            {onLoosen ? 'Loosen a criterion or reword the idea.' : 'Reword the idea.'}
          </p>
        ) : (
          <p>{idea.error ?? 'Research found nothing to show.'}</p>
        )}
        <div className="acts">
          {onLoosen && (
            <button type="button" className="btn small" onClick={onLoosen}>
              Loosen a criterion
            </button>
          )}
          <button type="button" className="btn small quiet" onClick={onReword}>
            Reword
          </button>
        </div>
      </Card>
    )
  }
  if (idea.status === 'error') {
    return (
      <Card dot="warn" title="Stopped">
        <p>{idea.error ?? 'Research stopped.'}</p>
        <div className="acts">
          <button type="button" className="btn small" onClick={onRerun}>
            Try again
          </button>
        </div>
      </Card>
    )
  }
  if (idea.status === 'researching') {
    const step = stepOf(status, idea.id)
    return (
      <Card dot="live" title={`Researching round ${next}`}>
        <p className="now" aria-live="polite">
          {step ?? 'Digging through shops and reviews'}…
        </p>
        <p>Usually a few minutes; you can leave.</p>
      </Card>
    )
  }
  if (idea.status !== 'queued') return null
  if (off) {
    return (
      <Card dot="off" title="Research is off">
        <p>API keys are missing on the server. This waits until they are set.</p>
      </Card>
    )
  }
  if (reset) {
    return (
      <Card dot="warn" title={`Out of quota until ${clockTime(reset)}`}>
        <p>Every model used its free quota. It picks up again by itself.</p>
      </Card>
    )
  }
  if (idea.nextAttemptAt) {
    return (
      <Card dot="warn" title={`Retrying around ${clockTime(idea.nextAttemptAt)}`}>
        <p>{idea.error ?? 'Hit a snag.'}</p>
        {/* attempts counts failures, so the retry is the next one. */}
        <p>
          Attempt {idea.attempts + 1} of {RETRY_MAX_ATTEMPTS} next.{idea.picks.length > 0 && ' Your previous picks stay until new ones arrive.'}
        </p>
        <div className="acts">
          <button type="button" className="btn small" onClick={onRerun}>
            Try now
          </button>
        </div>
      </Card>
    )
  }
  return (
    <Card dot="off" title={`Round ${next} is queued`}>
      <p>It starts after the current research, usually within minutes. No need to wait here.</p>
    </Card>
  )
}

export function Card({ dot, title, children }: { dot?: 'live' | 'warn' | 'off'; title: string; children: ReactNode }) {
  const id = useId()
  return (
    <section className="card status" aria-labelledby={id}>
      <h3 id={id}>
        {dot && <span className={`dot ${dot}`} aria-hidden="true" />}
        {title}
      </h3>
      {children}
    </section>
  )
}
