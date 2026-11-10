import type { IdeaStatus } from '../../types'

const TEXT: Record<IdeaStatus, string> = {
  queued: 'queued',
  researching: 'researching',
  done: 'done',
  error: 'stopped',
}

export function StatusBadge({ status, retrying = false }: { status: IdeaStatus; retrying?: boolean }) {
  const label = status === 'queued' && retrying ? 'retrying later' : TEXT[status]
  return (
    <span className={`badge badge-${status}`}>
      {status === 'researching' && <span className="pulse" aria-hidden="true" />}
      {label}
    </span>
  )
}
