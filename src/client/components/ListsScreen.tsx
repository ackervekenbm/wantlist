import { useState } from 'react'
import type { Idea, IdeaList, IdeaPatch } from '../../types'
import { boughtLine } from '../lib/format'
import { matches } from '../lib/filter'
import { isWorking, needOf, shownTitle } from '../lib/triage'
import { BackLink } from './BackLink'
import { ExploreIcon, SearchIcon } from './icons'

export const TABS: Array<{ list: IdeaList; label: string }> = [
  { list: 'wanted', label: 'Wanted' },
  { list: 'bought', label: 'Bought' },
  { list: 'archived', label: 'Archived' },
]

/** Above this many ideas in a list, a filter box appears. */
const FILTER_FROM = 8

interface Props {
  ideas: Idea[]
  tab: IdeaList
  onTab: (tab: IdeaList) => void
  onOpen: (id: number) => void
  onPatch: (id: number, patch: IdeaPatch) => void
  onRemove: (id: number) => void
}

/** The three lists: tabs with counts, a filter for long lists, one row per idea with its action. */
export function ListsScreen({ ideas, tab, onTab, onOpen, onPatch, onRemove }: Props) {
  const [filter, setFilter] = useState('')
  // The screen stays mounted across tabs (focus stays on the tab), so a new tab, from here or a home tile, drops the filter.
  const [shownTab, setShownTab] = useState(tab)
  if (tab !== shownTab) {
    setShownTab(tab)
    setFilter('')
  }
  const count = (list: IdeaList) => ideas.filter((i) => i.list === list).length
  const inTab = ideas.filter((i) => i.list === tab)
  const visible = filter.trim() ? inTab.filter((i) => matches(i, filter)) : inTab

  return (
    <div className="screen">
      <BackLink />
      <h1 tabIndex={-1}>Lists</h1>
      <nav className="tabs" aria-label="List tabs">
        {TABS.map(({ list, label }) => (
          <button key={list} type="button" aria-pressed={list === tab} onClick={() => onTab(list)}>
            {label}
            <span className="c">{count(list)}</span>
          </button>
        ))}
      </nav>

      {inTab.length > FILTER_FROM && (
        <div className="filter">
          <SearchIcon width={18} height={18} />
          <input
            type="search"
            placeholder={`Filter ${inTab.length} ideas`}
            aria-label="Filter ideas"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      )}

      <div className="card rows lists-card">
        {visible.length === 0 ? (
          <Empty list={tab} filtered={inTab.length > 0} />
        ) : (
          visible.map((idea) => {
            const title = shownTitle(idea)
            return (
              <div key={idea.id} className="lrow">
                <button type="button" className="row" data-idea-id={idea.id} onClick={() => onOpen(idea.id)}>
                  <span className="glyph explore">
                    <ExploreIcon />
                  </span>
                  <span className="row-main">
                    <span className="row-title t1">{title}</span>
                    <span className="row-sub">{subLine(idea)}</span>
                  </span>
                </button>
                {idea.list === 'wanted' ? (
                  <button
                    type="button"
                    className="btn small quiet"
                    aria-label={`Archive ${title}`}
                    onClick={() => onPatch(idea.id, { list: 'archived' })}
                  >
                    Archive
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="btn small quiet"
                      aria-label={`Want ${title} again`}
                      onClick={() => onPatch(idea.id, { list: 'wanted' })}
                    >
                      Want again
                    </button>
                    <button
                      type="button"
                      className="iconbtn x"
                      aria-label={`Remove ${title}`}
                      title="Remove"
                      onClick={() => onRemove(idea.id)}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

/** What the row says under the title: what happened, or what the idea is waiting for. */
function subLine(idea: Idea): string {
  if (idea.list === 'bought') {
    return idea.bought ? boughtLine(idea.bought) : 'Bought something else'
  }
  if (idea.list === 'archived') return 'Archived'
  const need = needOf(idea)
  if (need === 'react') return `React · round ${idea.round}`
  if (need === 'nothing-new') return 'Nothing new found'
  if (need === 'stopped') return 'Stopped'
  if (isWorking(idea)) return idea.status === 'researching' ? 'Researching' : 'Queued'
  return `Resting · round ${idea.round}`
}

function Empty({ list, filtered }: { list: IdeaList; filtered: boolean }) {
  if (filtered) return <div className="empty">Nothing matches that filter.</div>
  const text = {
    wanted: 'Nothing on the list.',
    bought: 'Nothing bought yet. When you buy one of the picks, press “I bought this” and it lands here.',
    archived: 'Nothing archived. Ideas you no longer want go here, out of the way but not forgotten.',
  }[list]
  return <div className="empty">{text}</div>
}
