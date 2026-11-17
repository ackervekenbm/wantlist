import type { ReactNode } from 'react'
import type { Idea, NewIdea, ServerStatus } from '../../types'
import { clockTime, formatEur, perUnitText } from '../lib/format'
import { bestOffer } from '../lib/hunt'
import { isWorking, latestPicks, needOf, pantryOf, quotaResetAt, shownTitle, stepOf, type Need } from '../lib/triage'
import { ChevronRightIcon, ExploreIcon, HuntIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { Leader, Section } from './Leader'
import type { ListTab } from '../lib/route'
import { TABS } from './ListsScreen'

interface Props {
  ideas: Idea[]
  status: ServerStatus | null
  /** The idea open in the right pane, highlighted on a PC. */
  selectedId: number | null
  /** The list open in the right pane, marked on its tile on a PC. */
  selectedList?: ListTab | null
  onOpen: (id: number) => void
  onLists: (tab: ListTab) => void
  onRunningLow: (id: number) => void
  onAdd: (idea: NewIdea) => Promise<void>
  /** Start a fresh idea: home, with the cursor in the add box on a PC. */
  onNewIdea: () => void
  /** False until the first fetch answers: capture works, the sections wait. */
  loaded?: boolean
}

const NEED_ORDER: Need[] = ['react', 'offer', 'nothing-new', 'stopped']

/** Capture, what needs you, what the researcher is on, and the list tiles. */
export function HomeScreen({ ideas, status, selectedId, selectedList = null, onOpen, onLists, onRunningLow, onAdd, onNewIdea, loaded = true }: Props) {
  // React first, then nothing new, then stopped; sort is stable, so server order holds within a group.
  const needs = ideas
    .flatMap((i) => {
      const need = needOf(i)
      return need ? [{ idea: i, need }] : []
    })
    .sort((a, b) => NEED_ORDER.indexOf(a.need) - NEED_ORDER.indexOf(b.need))
  const working = ideas.filter(isWorking)
  const pantry = pantryOf(ideas)
  const count = (list: ListTab) => ideas.filter((i) => i.list === list).length
  const reset = status && quotaResetAt(status)
  const rowProps = (idea: Idea) => ({
    type: 'button' as const,
    'data-idea-id': idea.id,
    'aria-current': idea.id === selectedId ? ('true' as const) : undefined,
    onClick: () => onOpen(idea.id),
  })

  return (
    <>
      <button type="button" className="btn newidea" onClick={onNewIdea}>
        + New idea
      </button>
      <IdeaForm compact submitLabel="Add" placeholder="What do you want?" onSubmit={(idea) => onAdd(idea)} />

      {status && !status.researchEnabled ? (
        <Notice>
          <b>Research is off.</b> {status.missingKeys.join(' and ')} {status.missingKeys.length > 1 ? 'are' : 'is'}{' '}
          missing on the server. Ideas are kept and researched once the keys are set.
        </Notice>
      ) : (
        reset && (
          <Notice>
            <b>Out of quota.</b> Every model has used its free allowance. Research picks up again around{' '}
            {clockTime(reset)}.
          </Notice>
        )
      )}

      {!loaded ? (
        <Skeleton />
      ) : ideas.length === 0 ? (
        <div className="card welcome">
          <p className="welcome-title">Nothing on the list.</p>
          <p>
            Type something you've been meaning to buy. wantlist researches it in the background (Belgian shops, prices
            in euro) and comes back with a few picks, checked prices and links.
          </p>
        </div>
      ) : (
        <>
          <Section title="Needs you" count={needs.length}>
            {needs.length > 0 ? (
              <div className="card rows">
                {needs.map(({ idea, need }) => (
                  <button key={idea.id} className="row" {...rowProps(idea)}>
                    <span className={`glyph ${idea.mode === 'hunt' ? 'hunt' : 'explore'}`}>
                      {idea.mode === 'hunt' ? <HuntIcon /> : <ExploreIcon />}
                    </span>
                    <span className="row-main">
                      <span className="row-title t1">{shownTitle(idea)}</span>
                      <NeedLine idea={idea} need={need} />
                    </span>
                    <ChevronRightIcon className="chev" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="card empty">Nothing needs you. New ideas are researched in the background.</div>
            )}
          </Section>

          {working.length > 0 && (
            <Section title="With the researcher" count={working.length}>
              <div className="card rows">
                {working.map((idea) => {
                  const live = idea.status === 'researching'
                  const retry = !live && idea.nextAttemptAt
                  const step = stepOf(status, idea.id)
                  return (
                    <button key={idea.id} className="mini" {...rowProps(idea)}>
                      <span className={`dot ${live ? 'live' : retry ? 'warn' : 'off'}`} aria-hidden="true" />
                      <Leader
                        fig={live ? (step ?? 'researching') : retry ? `retrying around ${clockTime(retry)}` : 'queued'}
                      >
                        {shownTitle(idea)}
                      </Leader>
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {pantry.length > 0 && (
            <Section title="Pantry" count={pantry.length}>
              <div className="card rows">
                {pantry.map((idea) => (
                  <div key={idea.id} className="lrow">
                    <button className="row" {...rowProps(idea)}>
                      <span className="glyph hunt">
                        <HuntIcon />
                      </span>
                      <span className="row-main">
                        <span className="row-title t1">{shownTitle(idea)}</span>
                        <span className="row-sub">Covered</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="btn small quiet"
                      aria-label={`Running low on ${shownTitle(idea)}`}
                      onClick={() => onRunningLow(idea.id)}
                    >
                      Running low
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}

          <nav className="listlinks" aria-label="Lists">
            {TABS.filter(({ list }) => list !== 'pantry').map(({ list, label }) => (
              <button
                key={list}
                type="button"
                aria-current={list === selectedList ? 'true' : undefined}
                onClick={() => onLists(list)}
              >
                <b>{count(list)}</b> {label}
              </button>
            ))}
          </nav>
        </>
      )}
    </>
  )
}

function NeedLine({ idea, need }: { idea: Idea; need: Need }) {
  if (need === 'react') {
    const left = latestPicks(idea).filter((p) => !p.reaction).length
    return (
      <Leader className="row-sub" fig={`${left} new pick${left === 1 ? '' : 's'}`}>
        <span className="act">React</span> · round {idea.round}
      </Leader>
    )
  }
  if (need === 'offer') {
    const best = bestOffer(idea)
    const unit = idea.target?.unit
    const perUnit = best?.offer?.perUnit
    const price = perUnit != null && unit ? perUnitText(perUnit, unit) : best?.offer?.delivered != null ? formatEur(best.offer.delivered) : ''
    return (
      <Leader className="row-sub" fig={price}>
        <span className="act">Best offer</span>
      </Leader>
    )
  }
  if (need === 'nothing-new') {
    return (
      <Leader className="row-sub" fig={`round ${idea.round + 1}`}>
        <span className="bad">Nothing new found</span>
      </Leader>
    )
  }
  return (
    <Leader className="row-sub" fig="try again">
      <span className="bad">Stopped</span>
    </Leader>
  )
}

function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="status">
      <b aria-hidden="true">!</b>
      <div>{children}</div>
    </div>
  )
}

export function Skeleton() {
  return (
    <div className="skeleton" aria-label="loading">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
    </div>
  )
}
