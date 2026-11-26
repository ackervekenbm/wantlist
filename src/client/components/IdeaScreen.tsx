import { Fragment, useState } from 'react'
import { isCovered, type Idea, type Pick as PickT, type ServerStatus } from '../../types'
import type { IdeasActions } from '../hooks/useIdeas'
import { boughtLine, formatEur } from '../lib/format'
import { exploreRounds, huntEyebrow } from '../lib/hunt'
import { latestPicks, shownTitle } from '../lib/triage'
import { BackLink } from './BackLink'
import { ExploreIcon, ExternalIcon, HuntIcon, MoreIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { IdeaTitle } from './IdeaTitle'
import { EarlierRounds } from './EarlierRounds'
import { HuntView } from './HuntView'
import { Keepers } from './Keepers'
import { ModeSwitch } from './ModeSwitch'
import { EarlierHunts } from './OfferList'
import { PickDeck } from './PickDeck'
import { PreferencesPanel } from './PreferencesPanel'
import { RefineBar } from './RefineBar'
import { Sheet } from './Sheet'
import { Card, StatusCard } from './StatusCard'
import { TargetPlate } from './TargetPlate'

interface Props {
  idea: Idea
  status: ServerStatus | null
  /** Back home, after Archive or Remove. */
  onBack: () => void
  actions: Pick<IdeasActions, 'patch' | 'rerun' | 'remove' | 'react' | 'refine' | 'switchMode' | 'huntPick' | 'buy' | 'runningLow' | 'setDelivery' | 'toPantry' | 'unbuy'>
}

/** One idea: header with the mode switch, where research stands, then Explore (learned, picks, refine) or the hunt. */
export function IdeaScreen({ idea, status, onBack, actions }: Props) {
  const [sheet, setSheet] = useState<'menu' | 'edit' | null>(null)
  const [editRequest, setEditRequest] = useState(0)
  const [tab, setTab] = useState<'research' | 'keepers'>('research')
  const { id } = idea
  const busy = idea.status === 'researching'
  const pending = busy || idea.status === 'queued'
  const wanted = idea.list === 'wanted'
  const hunt = idea.mode === 'hunt'
  const close = () => setSheet(null)
  const latest = latestPicks(idea)
  const explore = exploreRounds(idea)
  const earlier = explore.filter((p) => p.round !== latest[0]?.round)
  const keepers = explore.filter((p) => p.reaction === 'yes' || p.reaction === 'maybe')
  // The tabs appear with the first keeper; un-keeping the last one goes back to research.
  const onKeepers = tab === 'keepers' && keepers.length > 0
  const bought = (pick: PickT) => fire(patch({ list: 'bought', boughtPickId: pick.id }))
  const patch = (p: Parameters<typeof actions.patch>[1]) => actions.patch(id, p)
  const rerun = () => fire(actions.rerun(id))
  const huntPick = wanted && !pending ? (pick: PickT) => fire(actions.huntPick(id, pick.id)) : undefined
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

  // While the h1 is your own text, saying it again adds nothing.
  const yours = [
    shownTitle(idea) !== idea.text && (
      <>
        You wrote <q>{idea.text}</q>
      </>
    ),
    idea.notes,
    idea.budget !== null && `max ${formatEur(idea.budget)}`,
  ].filter(Boolean)

  return (
    <div className="screen idea-screen">
      {/* Pinned while the picks or offers scroll under it. */}
      <div className="idea-top">
        <div className="bar">
          <BackLink />
          <ModeSwitch mode={idea.mode} disabled={busy} onSwitch={(mode) => fire(actions.switchMode(id, mode))} />
          <button type="button" className="iconbtn more" aria-label="Idea actions" onClick={() => setSheet('menu')}>
            <MoreIcon width={20} height={20} />
          </button>
        </div>

        <header className="head">
          <p className="kicker">
            {hunt ? (
              <>
                <HuntIcon width={18} height={18} /> {huntEyebrow(idea)}
              </>
            ) : (
              <>
                <ExploreIcon width={18} height={18} /> Explore · {idea.round > 0 ? `round ${idea.round}` : 'first round'}
              </>
            )}
          </p>
          <IdeaTitle idea={idea} onRename={(title) => patch({ title })} />
          {yours.length > 0 && (
            <p className="yours">
              {yours.map((part, i) => (
                <Fragment key={i}>
                  {i > 0 && ' · '}
                  {part}
                </Fragment>
              ))}
            </p>
          )}
        </header>
      </div>

      {hunt && idea.target && (
        <TargetPlate
          target={idea.target}
          editable={!busy}
          editRequest={editRequest}
          onSave={async (target, again) => {
            await patch({ target })
            if (again) await actions.rerun(id)
          }}
        />
      )}

      {isCovered(idea) ? null : idea.list === 'bought' ? (
        <Card title="Bought">
          {idea.bought ? (
            <p>
              {boughtLine(idea.bought)}{' '}
              <a href={idea.bought.url} target="_blank" rel="noreferrer noopener">
                Open shop <ExternalIcon />
              </a>
            </p>
          ) : (
            <p>Bought something else.</p>
          )}
          {!busy && (
            <>
              <p className="hint">Runs out and you'll buy it again? Keep it in the Pantry, and hunt for the best price when you're running low.</p>
              <div className="acts">
                <button type="button" className="btn small" onClick={() => fire(actions.toPantry(id))}>
                  It's a refill: move to Pantry
                </button>
                <button type="button" className="btn small quiet" onClick={() => fire(actions.unbuy(id))}>
                  Didn't buy it after all
                </button>
              </div>
            </>
          )}
        </Card>
      ) : idea.list === 'archived' ? (
        <Card title="Archived">
          <p>Out of the way and not researched. Want it again from the menu to bring it back.</p>
        </Card>
      ) : (
        <StatusCard
          idea={idea}
          status={status}
          onRerun={rerun}
          onLoosen={(hunt ? idea.target : idea.preferences) ? () => setEditRequest((n) => n + 1) : undefined}
          onReword={() => setSheet('edit')}
        />
      )}

      {hunt ? (
        <HuntView idea={idea} actions={actions} />
      ) : (
        <>
          {keepers.length > 0 && (
            <nav className="tabs two" aria-label="Research or keepers">
              <button type="button" aria-pressed={!onKeepers} onClick={() => setTab('research')}>
                Research
              </button>
              <button type="button" aria-pressed={onKeepers} onClick={() => setTab('keepers')}>
                Keepers <span className="c">{keepers.length}</span>
              </button>
            </nav>
          )}

          {onKeepers ? (
            <Keepers picks={explore} onReact={wanted ? actions.react : undefined} onBought={wanted ? bought : undefined} onHunt={huntPick} />
          ) : (
            <>
              <PickDeck key={`${id}-${latest[0]?.round}`} idea={idea} onReact={actions.react} onBought={bought} onHunt={huntPick} />

              {idea.preferences && (
                <PreferencesPanel
                  preferences={idea.preferences}
                  editable={!pending}
                  editRequest={editRequest}
                  onSave={(preferences) => patch({ preferences })}
                />
              )}

              <EarlierRounds
                picks={earlier}
                onReact={wanted ? actions.react : undefined}
                onBought={wanted ? bought : undefined}
              />

              <EarlierHunts idea={idea} />
            </>
          )}

          {wanted && !pending && explore.length > 0 && !onKeepers && (
            <RefineBar
              reactions={latest.filter((p) => p.reaction).length}
              round={idea.round}
              anyReaction={explore.some((p) => p.reaction)}
              preferencesEdited={idea.preferencesEdited}
              onRefine={() => actions.refine(id)}
            />
          )}
        </>
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
