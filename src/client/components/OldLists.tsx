import { useState } from 'react'
import type { Idea, IdeaList } from '../../types'
import type { IdeasActions, IdeasState } from '../hooks/useIdeas'
import { matches } from '../lib/filter'
import { BackIcon } from './icons'
import { IdeaCard } from './IdeaCard'
import { shownTitle } from './IdeaTitle'

// shortcut: the pre-redesign tabbed list (moved verbatim from App.tsx) and the old IdeaCard stand in for
// the Lists and idea screens; Tasks 4 and 5 replace this file.

const TABS: Array<{ list: IdeaList; label: string }> = [
  { list: 'wanted', label: 'Wanted' },
  { list: 'bought', label: 'Bought' },
  { list: 'archived', label: 'Archived' },
]

/** Above this many ideas in a list, a filter box appears. */
const FILTER_FROM = 8

export function OldLists({
  state,
  tab,
  onTab,
}: {
  state: IdeasState & IdeasActions
  tab: IdeaList
  onTab: (tab: IdeaList) => void
}) {
  const [filter, setFilter] = useState('')
  const counts: Record<IdeaList, number> = { wanted: 0, bought: 0, archived: 0 }
  for (const i of state.ideas) counts[i.list] += 1

  const inTab = state.ideas.filter((i) => i.list === tab)
  const visible = filter.trim() ? inTab.filter((i) => matches(i, filter)) : inTab

  return (
    <div className="screen content">
      <BackLink />
      <h1 tabIndex={-1}>Lists</h1>
      <nav className="tabs" aria-label="List tabs">
        {TABS.map(({ list, label }) => (
          <button
            key={list}
            type="button"
            className={list === tab ? 'tab tab-active' : 'tab'}
            aria-pressed={list === tab}
            onClick={() => onTab(list)}
          >
            {label}
            <span className="tab-count">{counts[list]}</span>
          </button>
        ))}
      </nav>

      {inTab.length > FILTER_FROM && (
        <input
          type="search"
          className="input filter"
          placeholder={`Filter ${inTab.length} ideas`}
          aria-label="Filter ideas"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}

      {visible.length === 0 ? (
        <EmptyState list={tab} filtered={inTab.length > 0} />
      ) : (
        <section className="ideas" aria-label={`${tab} ideas`}>
          {visible.map((idea) => (
            <IdeaCardFor key={idea.id} idea={idea} state={state} />
          ))}
        </section>
      )}
    </div>
  )
}

function EmptyState({ list, filtered }: { list: IdeaList; filtered: boolean }) {
  if (filtered) return <p className="empty-sub">Nothing matches that filter.</p>
  if (list === 'bought') {
    return (
      <div className="empty">
        <p className="empty-title">Nothing bought yet.</p>
        <p className="empty-sub">When you buy one of the picks, press “I bought this” and it lands here.</p>
      </div>
    )
  }
  if (list === 'archived') {
    return (
      <div className="empty">
        <p className="empty-title">Nothing archived.</p>
        <p className="empty-sub">Ideas you no longer want go here, out of the way but not forgotten.</p>
      </div>
    )
  }
  return (
    <div className="empty">
      <div className="empty-glyph" aria-hidden="true">
        ✥
      </div>
      <p className="empty-title">Nothing on the list.</p>
      <p className="empty-sub">
        Type something you've been meaning to buy. The app researches it in the background (Belgian shops, prices
        in euro) and comes back with a few picks, checked prices and links.
      </p>
    </div>
  )
}

/** The phone's way home; the PC keeps home in the left pane. */
export function BackLink() {
  return (
    <a className="back" href="#/">
      <BackIcon width={18} height={18} /> Home
    </a>
  )
}

export function IdeaCardFor({ idea, state, open }: { idea: Idea; state: IdeasState & IdeasActions; open?: boolean }) {
  return (
    <IdeaCard
      idea={idea}
      forceOpen={open}
      step={state.status?.current?.ideaId === idea.id ? state.status.current.step : null}
      onPatch={(patch) => state.patch(idea.id, patch)}
      onRerun={() => state.rerun(idea.id)}
      onReact={state.react}
      onRefine={() => state.refine(idea.id)}
      onRemove={() => state.remove(idea.id)}
    />
  )
}

export function OldIdea({ idea, state }: { idea: Idea; state: IdeasState & IdeasActions }) {
  return (
    <div className="screen">
      <BackLink />
      <h1 tabIndex={-1}>{shownTitle(idea)}</h1>
      <IdeaCardFor idea={idea} state={state} open />
    </div>
  )
}
