import type { IdeaStatus } from '../../types'

const STATUS_TEXT: Record<IdeaStatus, string> = {
  queued: 'queued',
  researching: 'researching',
  done: 'done',
  error: 'error',
}

export function StatusBadge({ status }: { status: IdeaStatus }) {
  return (
    <span className={`badge badge-${status}`}>
      {status === 'researching' && <span className="badge-pulse" aria-hidden />}
      {STATUS_TEXT[status]}
    </span>
  )
}