import { useState } from 'react'
import type { Idea, IdeaPatch, Pick, PickPatch } from '../../types'
import { clockTime, formatEur, hostOf, timeAgo } from '../lib/format'
import { EarlierRounds } from './EarlierRounds'
import { BagIcon, ExternalIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { IdeaTitle, shownTitle } from './IdeaTitle'
import { Keepers } from './Keepers'
import { PickCard } from './PickCard'
import { PreferencesPanel } from './PreferencesPanel'
import { ReactionBar } from './ReactionBar'
import { RefineBar } from './RefineBar'
import { StatusBadge } from './StatusBadge'

interface Props {
  idea: Idea
  /** The worker's current step while this idea is being researched. */
  step: string | null
  onPatch: (patch: IdeaPatch) => Promise<void>
  onRerun: () => Promise<void>
  onReact: (pickId: number, patch: PickPatch) => Promise<void>
  onRefine: () => Promise<void>
  onRemove: () => void
}

export function IdeaCard({ idea, step, onPatch, onRerun, onReact, onRefine, onRemove }: Props) {
  const [editing, setEditing] = useState(false)
  const busy = idea.status === 'researching'
  const pending = busy || idea.status === 'queued'
  const wanted = idea.list === 'wanted'
  // Picks come newest round first; reading the round off them keeps the card full even if idea.round disagrees.
  const latest = idea.picks[0]?.round
  const current = idea.picks.filter((p) => p.round === latest)
  const earlier = idea.picks.filter((p) => p.round !== latest)
  const keepers = earlier.filter((p) => p.reaction === 'yes')
  const bought = (pick: Pick) => fire(onPatch({ list: 'bought', boughtPickId: pick.id }))

  const renderPick = (pick: Pick) => (
    <PickCard
      key={pick.id}
      pick={pick}
      budget={idea.budget}
      onBought={wanted ? () => bought(pick) : undefined}
      reaction={
        wanted && (
          <ReactionBar
            title={pick.title}
            reaction={pick.reaction}
            reason={pick.reason}
            onReact={(patch) => onReact(pick.id, patch)}
          />
        )
      }
    />
  )

  return (
    <article className={`idea idea-${idea.list}`} aria-label={shownTitle(idea)}>
      <header className="idea-head">
        <IdeaTitle idea={idea} onRename={(title) => onPatch({ title })} />
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

      <div className="idea-body">
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

        {idea.preferences && (
          <PreferencesPanel
            preferences={idea.preferences}
            editable={!pending}
            onSave={(preferences) => onPatch({ preferences })}
          />
        )}

        <Keepers picks={keepers} onBought={wanted ? bought : undefined} />

        {current.length > 0 && (
          <ol className="picks" aria-label={`Round ${latest} picks`}>
            {current.map(renderPick)}
          </ol>
        )}

        {wanted && !pending && idea.picks.length > 0 && (
          <RefineBar
            reactions={current.filter((p) => p.reaction).length}
            anyReaction={idea.picks.some((p) => p.reaction)}
            preferencesEdited={idea.preferencesEdited}
            onRefine={onRefine}
          />
        )}

        <EarlierRounds picks={earlier} renderPick={renderPick} />

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
    return <p className="idea-note" role="status">Waiting for the researcher. Results usually take a minute or two.</p>
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
