import type { Idea, Pick } from '../../types'
import { StatusBadge } from './StatusBadge'

interface Props {
  idea: Idea
  onRerun: () => void
  onDelete: () => void
}

export function IdeaCard({ idea, onRerun, onDelete }: Props) {
  return (
    <article className="idea">
      <header className="idea-head">
        <p className="idea-text">{idea.text}</p>
        <div className="idea-meta">
          <StatusBadge status={idea.status} />
          <time className="idea-date" dateTime={idea.createdAt}>
            {formatDate(idea.createdAt)}
          </time>
        </div>
      </header>

      {idea.error && idea.status === 'error' && (
        <p className="idea-error" title={idea.error}>
          {idea.error}
        </p>
      )}

      {idea.status === 'researching' && (
        <p className="idea-note">digging through shops and reviews… this can take a minute.</p>
      )}

      {idea.picks.length > 0 && (
        <ol className="picks">
          {idea.picks.map((pick) => (
            <PickRow key={pick.id} pick={pick} />
          ))}
        </ol>
      )}

      <footer className="idea-actions">
        {(idea.status === 'done' || idea.status === 'error') && (
          <button className="linklike" onClick={onRerun}>
            research again
          </button>
        )}
        <button className="linklike linklike-danger" onClick={onDelete}>
          remove
        </button>
      </footer>
    </article>
  )
}

function PickRow({ pick }: { pick: Pick }) {
  const host = hostOf(pick.url)
  return (
    <li className="pick">
      <span className={`pick-rank rank-${pick.rank <= 3 ? pick.rank : 'n'}`}>{pick.rank}</span>
      <div className="pick-body">
        <div className="pick-top">
          <p className="pick-title">{pick.title}</p>
          {pick.price && <span className="pick-price">{pick.price}</span>}
        </div>
        {pick.why && <p className="pick-why">{pick.why}</p>}
        <div className="pick-bottom">
          <span className="pick-shop">{pick.shop}</span>
          <a className="pick-link" href={pick.url} target="_blank" rel="noreferrer noopener">
            open shop <span className="pick-host">{host}</span> ↗
          </a>
        </div>
      </div>
    </li>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function formatDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso + 'Z')
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}