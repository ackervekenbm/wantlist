import { useEffect, useMemo, useRef, useState } from 'react'
import type { Idea, IdeaList } from '../types'
import { IdeaCard } from './components/IdeaCard'
import { IdeaForm } from './components/IdeaForm'
import { Shell } from './components/Shell'
import { TopBar } from './components/TopBar'
import { useIdeas } from './hooks/useIdeas'
import { useRoute, type Route } from './lib/route'
import { applyTheme, readTheme, writeTheme, type Theme } from './lib/theme'

const TABS: Array<{ list: IdeaList; label: string }> = [
  { list: 'wanted', label: 'Wanted' },
  { list: 'bought', label: 'Bought' },
  { list: 'archived', label: 'Archived' },
]

/** Above this many ideas in a list, a filter box appears. */
const FILTER_FROM = 8

export function App() {
  const state = useIdeas()
  const [route, navigate] = useRoute()
  const [theme, setTheme] = useState<Theme>(readTheme)
  const [tab, setTab] = useState<IdeaList>('wanted')
  const [filter, setFilter] = useState('')

  const counts = useMemo(() => {
    const c: Record<IdeaList, number> = { wanted: 0, bought: 0, archived: 0 }
    for (const i of state.ideas) c[i.list] += 1
    return c
  }, [state.ideas])

  const inTab = state.ideas.filter((i) => i.list === tab)
  const visible = filter.trim() ? inTab.filter((i) => matches(i, filter)) : inTab

  const openIdea = route.name === 'idea' ? state.ideas.find((i) => i.id === route.id) : undefined
  const missingIdea = route.name === 'idea' && state.loaded && !openIdea
  useEffect(() => {
    if (missingIdea) navigate({ name: 'home' }, { replace: true })
  }, [missingIdea, navigate])

  useRouteFocus(route, state.loaded)

  const currentId = state.status?.current?.ideaId
  const current = state.ideas.find((i) => i.id === currentId)

  const left = (
    <div className="app">
      <TopBar
        status={state.status}
        currentTitle={current ? (current.title ?? current.text) : null}
        theme={theme}
        onTheme={(t) => {
          writeTheme(t)
          applyTheme(t)
          setTheme(t)
        }}
      />

      <main className="content">
        {state.status && !state.status.researchEnabled && (
          <div className="banner banner-warn" role="status">
            Research is switched off: set {state.status.missingKeys.join(' and ')} on the server. Ideas you add now
            wait in the queue until it is on.
          </div>
        )}

        <section className="capture" aria-label="Add an idea">
          <IdeaForm
            compact
            submitLabel="Add to wantlist"
            placeholder="e.g. A good fan to add to my indoor biking setup"
            onSubmit={async (idea) => {
              await state.add(idea)
              setTab('wanted')
              setFilter('')
            }}
          />
        </section>

        <nav className="tabs" aria-label="Lists">
          {TABS.map(({ list, label }) => (
            <button
              key={list}
              type="button"
              className={list === tab ? 'tab tab-active' : 'tab'}
              aria-pressed={list === tab}
              onClick={() => setTab(list)}
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

        {!state.loaded ? (
          <Skeleton />
        ) : visible.length === 0 ? (
          <EmptyState list={tab} filtered={inTab.length > 0} />
        ) : (
          <section className="ideas" aria-label={`${tab} ideas`}>
            {visible.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                step={state.status?.current?.ideaId === idea.id ? state.status.current.step : null}
                onPatch={(patch) => state.patch(idea.id, patch)}
                onRerun={() => state.rerun(idea.id)}
                onReact={state.react}
                onRefine={() => state.refine(idea.id)}
                onRemove={() => state.remove(idea.id)}
              />
            ))}
          </section>
        )}
      </main>

      <footer className="foot">
        <span>every idea, researched for later.</span>
      </footer>
    </div>
  )

  // shortcut: placeholder screens until the idea and lists screens land (Tasks 3–4).
  const right =
    route.name === 'lists' ? (
      <div className="screen">
        <h1 tabIndex={-1}>Lists</h1>
      </div>
    ) : !state.loaded ? (
      <div className="screen" aria-busy="true">
        <Skeleton />
      </div>
    ) : openIdea ? (
      <div className="screen">
        <h1 tabIndex={-1}>{openIdea.title ?? openIdea.text}</h1>
      </div>
    ) : null

  return (
    <Shell
      route={route}
      left={left}
      right={right}
      banner={
        state.error && (
          <div className="banner banner-bad" role="alert">
            <span>{state.error}</span>
            <button type="button" className="banner-close" onClick={state.dismissError}>
              dismiss
            </button>
          </div>
        )
      }
      toast={
        state.removed && (
          <div className="toast" role="status">
            <span>Removed “{truncate(state.removed.text, 40)}”</span>
            <button type="button" className="btn-text toast-undo" onClick={state.undoRemove}>
              undo
            </button>
          </div>
        )
      }
    />
  )
}

/**
 * Opening an idea or the lists focuses that screen's h1 and scrolls to the
 * top; going back home returns focus to the idea's row, when there is one.
 */
function useRouteFocus(route: Route, loaded: boolean) {
  const previous = useRef(route)
  useEffect(() => {
    const prev = previous.current
    previous.current = route
    if (route.name === 'home') {
      if (prev.name === 'idea') document.querySelector<HTMLElement>(`[data-idea-id="${prev.id}"]`)?.focus()
      return
    }
    const h1 = document.querySelector<HTMLElement>('.pane-right h1')
    if (!h1) return
    h1.focus({ preventScroll: true })
    // Below 900 px the document scrolls, from 900 px the pane; resetting both is right in either layout.
    document.documentElement.scrollTop = 0
    const pane = h1.closest<HTMLElement>('.pane')
    if (pane) pane.scrollTop = 0
  }, [route, loaded])
}

function Skeleton() {
  return (
    <div className="skeleton" aria-label="loading">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="skeleton-card" />
      ))}
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

function matches(idea: Idea, query: string): boolean {
  const q = query.trim().toLowerCase()
  return [idea.title, idea.text, idea.notes, idea.preferences?.summary, ...idea.picks.map((p) => p.title)].some((s) =>
    s?.toLowerCase().includes(q),
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
