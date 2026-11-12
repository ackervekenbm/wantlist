import type { ReactNode } from 'react'
import type { Idea, IdeaList, NewIdea, ServerStatus } from '../../types'
import { clockTime } from '../lib/format'
import { isWorking, latestPicks, needOf, quotaResetAt, type Need } from '../lib/triage'
import { ChevronRightIcon, ExploreIcon } from './icons'
import { IdeaForm } from './IdeaForm'
import { shownTitle } from './IdeaTitle'
import { Leader } from './Leader'

interface Props {
  ideas: Idea[]
  status: ServerStatus | null
  /** The idea open in the right pane, highlighted on a PC. */
  selectedId: number | null
  onOpen: (id: number) => void
  onLists: (tab: IdeaList) => void
  onAdd: (idea: NewIdea) => Promise<void>
  /** False until the first fetch answers: capture works, the sections wait. */
  loaded?: boolean
}

const TILES: Array<{ list: IdeaList; label: string }> = [
  { list: 'wanted', label: 'Wanted' },
  { list: 'bought', label: 'Bought' },
  { list: 'archived', label: 'Archived' },
]

const NEED_ORDER: Need[] = ['react', 'nothing-new', 'stopped']

/** Capture, what needs you, what the researcher is on, and the list tiles. */
export function HomeScreen({ ideas, status, selectedId, onOpen, onLists, onAdd, loaded = true }: Props) {
  // React first, then nothing new, then stopped; sort is stable, so server order holds within a group.
  const needs = ideas
    .flatMap((i) => {
      const need = needOf(i)
      return need ? [{ idea: i, need }] : []
    })
    .sort((a, b) => NEED_ORDER.indexOf(a.need) - NEED_ORDER.indexOf(b.need))
  const working = ideas.filter(isWorking)
  const count = (list: IdeaList) => ideas.filter((i) => i.list === list).length
  const reset = status && quotaResetAt(status)
  const rowProps = (idea: Idea) => ({
    type: 'button' as const,
    'data-idea-id': idea.id,
    'aria-current': idea.id === selectedId ? ('true' as const) : undefined,
    onClick: () => onOpen(idea.id),
  })

  return (
    <>
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
          <Section id="h-need" title="Needs you" count={needs.length}>
            {needs.length > 0 ? (
              <div className="card rows">
                {needs.map(({ idea, need }) => (
                  <button key={idea.id} className="row" {...rowProps(idea)}>
                    <span className="glyph explore">
                      <ExploreIcon />
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
            <Section id="h-wait" title="With the researcher" count={working.length}>
              <div className="card rows">
                {working.map((idea) => {
                  const live = idea.status === 'researching'
                  const retry = !live && idea.nextAttemptAt
                  const step = status?.current?.ideaId === idea.id ? status.current.step : null
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

          <nav className="listlinks" aria-label="Lists">
            {TILES.map(({ list, label }) => (
              <button key={list} type="button" onClick={() => onLists(list)}>
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

function Section({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section className="sec" aria-labelledby={id}>
      <h2 className="sec-h" id={id}>
        {title} <span className="n">{count}</span>
        <span className="rule" />
      </h2>
      {children}
    </section>
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
