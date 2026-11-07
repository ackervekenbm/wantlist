import { useId, useState } from 'react'
import type { Idea, IdeaPatch } from '../../types'
import { readCollapsed, writeCollapsed } from '../lib/storage'
import { clockTime, formatEur, hostOf, timeAgo } from '../lib/format'
import { BagIcon, ChevronIcon, ExternalIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { PickCard } from './PickCard'
import { StatusBadge } from './StatusBadge'

interface Props {
  idea: Idea
  /** The worker's current step while this idea is being researched. */
  step: string | null
  onPatch: (patch: IdeaPatch) => Promise<void>
  onRerun: () => Promise<void>
  onRemove: () => void
}

export function IdeaCard({ idea, step, onPatch, onRerun, onRemove }: Props) {
  const [collapsed, setCollapsed] = useState(() => readCollapsed().has(idea.id))
  const [editing, setEditing] = useState(false)
  const bodyId = useId()
  const busy = idea.status === 'researching'
  const top = idea.picks[0]

  const toggle = () => {
    setCollapsed((was) => {
      writeCollapsed(idea.id, !was)
      return !was
    })
  }

  return (
    <article className={`idea idea-${idea.list}`} aria-label={idea.text}>
      <header className="idea-head">
        <button type="button" className="idea-toggle" aria-expanded={!collapsed} aria-controls={bodyId} onClick={toggle}>
          <h3 className="idea-text">{idea.text}</h3>
          <ChevronIcon className={collapsed ? 'chevron' : 'chevron chevron-open'} />
        </button>
        <div className="idea-meta">
          {idea.list === 'wanted' && idea.status !== 'done' && (
            <StatusBadge status={idea.status} retrying={!!idea.nextAttemptAt} />
          )}
          {idea.budget !== null && <span className="tag">up to {formatEur(idea.budget)}</span>}
          <time className="idea-date" dateTime={idea.researchedAt ?? idea.createdAt}>
            {idea.researchedAt ? `researched ${timeAgo(idea.researchedAt)}` : `added ${timeAgo(idea.createdAt)}`}
          </time>
        </div>
      </header>

      {collapsed ? (
        <p className="idea-collapsed" id={bodyId}>
          {idea.bought
            ? `Bought ${idea.bought.title}`
            : top
              ? `Top pick: ${top.title}${top.price !== null ? ` · ${formatEur(top.price)}` : ''}`
              : 'No picks yet'}
          {idea.picks.length > 1 && !idea.bought ? ` · ${idea.picks.length} picks` : ''}
        </p>
      ) : (
        <div className="idea-body" id={bodyId}>
          {idea.notes && !editing && <p className="idea-notes">{idea.notes}</p>}

          {idea.list === 'bought' && (
            <p className="idea-bought">
              <BagIcon />
              {idea.bought ? (
                <span>
                  Bought <strong>{idea.bought.title}</strong>
                  {idea.bought.shop ? ` at ${idea.bought.shop}` : ''}
                  {idea.bought.price !== null ? ` for ${formatEur(idea.bought.price)}` : ''}
                  {idea.bought.at ? `, ${timeAgo(idea.bought.at)}` : ''}.{' '}
                  <a href={idea.bought.url} target="_blank" rel="noreferrer noopener">
                    {hostOf(idea.bought.url)} <ExternalIcon />
                  </a>
                </span>
              ) : (
                <span>Bought something else.</span>
              )}
            </p>
          )}

          <ResearchState idea={idea} step={step} />

          {idea.summary && (
            <div className="brief">
              <p className="brief-summary">{idea.summary}</p>
              {idea.criteria.length > 0 && (
                <ul className="brief-criteria" aria-label="What matters">
                  {idea.criteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {idea.picks.length > 0 && (
            <ol className="picks" aria-label={`Picks for ${idea.text}`}>
              {idea.picks.map((pick) => (
                <PickCard
                  key={pick.id}
                  pick={pick}
                  budget={idea.budget}
                  onBought={
                    idea.list === 'wanted' ? () => fire(onPatch({ list: 'bought', boughtPickId: pick.id })) : undefined
                  }
                />
              ))}
            </ol>
          )}

          {editing ? (
            <IdeaForm
              initial={idea}
              submitLabel="Save"
              secondaryLabel={busy ? undefined : 'Save & research again'}
              onCancel={() => setEditing(false)}
              onSubmit={async (values, again) => {
                await onPatch(values)
                if (again) await onRerun()
                setEditing(false)
              }}
            />
          ) : (
            <footer className="idea-actions">
              {idea.list === 'wanted' ? (
                <>
                  <button type="button" className="btn-text" onClick={() => setEditing(true)}>
                    edit
                  </button>
                  {!busy && (
                    <button type="button" className="btn-text" onClick={() => fire(onRerun())}>
                      research again
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn-text"
                    onClick={() => fire(onPatch({ list: 'bought', boughtPickId: null }))}
                  >
                    bought something else
                  </button>
                  <button type="button" className="btn-text" onClick={() => fire(onPatch({ list: 'archived' }))}>
                    don't want it anymore
                  </button>
                </>
              ) : (
                <button type="button" className="btn-text" onClick={() => fire(onPatch({ list: 'wanted' }))}>
                  want it again
                </button>
              )}
              <button type="button" className="btn-text btn-danger" onClick={onRemove}>
                remove
              </button>
            </footer>
          )}
        </div>
      )}
    </article>
  )
}

function ResearchState({ idea, step }: { idea: Idea; step: string | null }) {
  if (idea.list !== 'wanted') return null
  if (idea.status === 'researching') {
    return (
      <p className="idea-note" role="status">
        <span className="pulse" aria-hidden="true" />
        {step ? `${step}…` : 'Digging through shops and reviews…'}
        {idea.picks.length > 0 && ' The picks below stay until the new ones are in.'}
      </p>
    )
  }
  if (idea.status === 'queued' && idea.nextAttemptAt) {
    return (
      <p className="idea-note" title={idea.error ?? undefined}>
        Hit a snag; trying again around {clockTime(idea.nextAttemptAt)}.
        {idea.error && <span className="idea-note-detail"> {idea.error}</span>}
      </p>
    )
  }
  if (idea.status === 'queued') {
    return <p className="idea-note">Waiting for the researcher. Results usually take a minute or two.</p>
  }
  if (idea.status === 'error') {
    return (
      <p className="idea-error" role="alert">
        Research stopped: {idea.error ?? 'unknown error'}
      </p>
    )
  }
  return null
}

/**
 * For buttons: the hook already shows a failed request in the app's error
 * banner, so the rejection is handled here instead of escaping unhandled.
 */
function fire(p: Promise<void>): void {
  p.catch(() => {})
}
