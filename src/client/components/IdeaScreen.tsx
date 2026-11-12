import { useState } from 'react'
import type { Idea, ServerStatus } from '../../types'
import type { IdeasActions } from '../hooks/useIdeas'
import { formatEur } from '../lib/format'
import { latestPicks } from '../lib/triage'
import { BackLink } from './BackLink'
import { ExploreIcon, ExternalIcon, MoreIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { IdeaTitle, shownTitle } from './IdeaTitle'
import { PickList } from './PickList'
import { PreferencesPanel } from './PreferencesPanel'
import { RefineBar } from './RefineBar'
import { Sheet } from './Sheet'
import { Card, StatusCard } from './StatusCard'

interface Props {
  idea: Idea
  status: ServerStatus | null
  /** Back home, after Archive or Remove. */
  onBack: () => void
  actions: Pick<IdeasActions, 'patch' | 'rerun' | 'remove' | 'react' | 'refine'>
}

/** One Explore idea: header, where research stands, what was learned, the picks and refine. */
export function IdeaScreen({ idea, status, onBack, actions }: Props) {
  const [sheet, setSheet] = useState<'menu' | 'edit' | null>(null)
  const [editRequest, setEditRequest] = useState(0)
  const { id } = idea
  const busy = idea.status === 'researching'
  const pending = busy || idea.status === 'queued'
  const wanted = idea.list === 'wanted'
  const close = () => setSheet(null)
  const patch = (p: Parameters<typeof actions.patch>[1]) => actions.patch(id, p)
  const rerun = () => fire(actions.rerun(id))
  /** Closes the menu, then runs the action. */
  const item = (label: string, run: () => void, danger = false) => (
    <li>
      <button
        type="button"
        className={danger ? 'danger' : undefined}
        onClick={() => {
          close()
          run()
        }}
      >
        {label}
      </button>
    </li>
  )

  return (
    <div className="screen idea-screen">
      <div className="bar">
        <BackLink />
        <button type="button" className="iconbtn more" aria-label="Idea actions" onClick={() => setSheet('menu')}>
          <MoreIcon width={20} height={20} />
        </button>
      </div>

      <header className="head">
        <p className="kicker">
          <ExploreIcon width={18} height={18} /> Explore · {idea.round > 0 ? `round ${idea.round}` : 'first round'}
        </p>
        <IdeaTitle idea={idea} onRename={(title) => patch({ title })} />
        <p className="yours">
          You wrote <q>{idea.text}</q>
          {idea.notes && ` · ${idea.notes}`}
          {idea.budget !== null && ` · max ${formatEur(idea.budget)}`}
        </p>
      </header>

      {idea.list === 'bought' ? (
        <Card title="Bought">
          {idea.bought ? (
            <p>
              {[idea.bought.title, idea.bought.shop, idea.bought.price === null ? null : formatEur(idea.bought.price)]
                .filter(Boolean)
                .join(' · ')}{' '}
              <a href={idea.bought.url} target="_blank" rel="noreferrer noopener">
                Open shop <ExternalIcon />
              </a>
            </p>
          ) : (
            <p>Bought something else.</p>
          )}
        </Card>
      ) : (
        wanted && (
          <StatusCard
            idea={idea}
            status={status}
            onRerun={rerun}
            onLoosen={idea.preferences ? () => setEditRequest((n) => n + 1) : undefined}
            onReword={() => setSheet('edit')}
          />
        )
      )}

      {idea.preferences && (
        <PreferencesPanel
          preferences={idea.preferences}
          editable={!pending}
          editRequest={editRequest}
          onSave={(preferences) => patch({ preferences })}
        />
      )}

      <PickList
        idea={idea}
        onReact={actions.react}
        onBought={(pick) => fire(patch({ list: 'bought', boughtPickId: pick.id }))}
      />

      {wanted && !pending && idea.picks.length > 0 && (
        <RefineBar
          reactions={latestPicks(idea).filter((p) => p.reaction).length}
          anyReaction={idea.picks.some((p) => p.reaction)}
          preferencesEdited={idea.preferencesEdited}
          onRefine={() => actions.refine(id)}
        />
      )}

      <Sheet open={sheet === 'menu'} onClose={close} title={shownTitle(idea)}>
        <ul className="menu">
          {wanted ? (
            <>
              {item('Edit idea', () => setSheet('edit'))}
              {!pending && item('Research again', rerun)}
              {item('Bought something else', () => fire(patch({ list: 'bought', boughtPickId: null })))}
              {item('Archive', () => fire(patch({ list: 'archived' }).then(onBack)))}
            </>
          ) : (
            item('Want again', () => fire(patch({ list: 'wanted' })))
          )}
          {item(
            'Remove',
            () => {
              actions.remove(id)
              onBack()
            },
            true,
          )}
          {item('Cancel', () => {})}
        </ul>
      </Sheet>

      <Sheet open={sheet === 'edit'} onClose={close} title="Edit idea">
        <IdeaForm
          initial={idea}
          submitLabel="Save"
          secondaryLabel={busy ? undefined : 'Save & research again'}
          onCancel={close}
          onSubmit={async (values, again) => {
            await patch(values)
            if (again) await actions.rerun(id)
            close()
          }}
        />
      </Sheet>
    </div>
  )
}

/**
 * For buttons: the hook already shows a failed request in the app's error
 * banner, so the rejection is handled here instead of escaping unhandled.
 */
function fire(p: Promise<void>): void {
  p.catch(() => {})
}
