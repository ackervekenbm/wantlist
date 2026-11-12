import { useMemo, useState } from 'react'
import type { Idea, IdeaList, ServerStatus } from '../types'
import { IdeaCard } from './components/IdeaCard'
import { IdeaForm } from './components/IdeaForm'
import { useIdeas } from './hooks/useIdeas'
import { clockTime } from './lib/format'

const TABS: Array<{ list: IdeaList; label: string }> = [
  { list: 'wanted', label: 'Wanted' },
  { list: 'bought', label: 'Bought' },
  { list: 'archived', label: 'Archived' },
]

/** Above this many ideas in a list, a filter box appears. */
const FILTER_FROM = 8

export function App() {
  const state = useIdeas()
  const [tab, setTab] = useState<IdeaList>('wanted')
  const [filter, setFilter] = useState('')

  const counts = useMemo(() => {
    const c: Record<IdeaList, number> = { wanted: 0, bought: 0, archived: 0 }
    for (const i of state.ideas) c[i.list] += 1
    return c
  }, [state.ideas])

  const inTab = state.ideas.filter((i) => i.list === tab)
  const visible = filter.trim() ? inTab.filter((i) => matches(i, filter)) : inTab

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark" aria-label="wantlist">
          <span className="wordmark-mark" aria-hidden="true">
            w
          </span>
          <span className="wordmark-text" aria-hidden="true">
            wantlist
          </span>
        </div>
        <WorkerChip status={state.status} />
      </header>

      <main className="content">
        {state.error && (
          <div className="banner banner-bad" role="alert">
            <span>{state.error}</span>
            <button type="button" className="banner-close" onClick={state.dismissError}>
              dismiss
            </button>
          </div>
        )}

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
          <div className="skeleton" aria-label="loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
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

      {state.removed && (
        <div className="toast" role="status">
          <span>Removed “{truncate(state.removed.text, 40)}”</span>
          <button type="button" className="btn-text toast-undo" onClick={state.undoRemove}>
            undo
          </button>
        </div>
      )}

      <footer className="foot">
        <span>every idea, researched for later.</span>
      </footer>
    </div>
  )
}

function WorkerChip({ status }: { status: ServerStatus | null }) {
  if (!status) return null
  if (!status.researchEnabled) return <span className="chip chip-off">research off</span>
  if (status.running) {
    return (
      <span className="chip chip-live">
        <span className="pulse" aria-hidden="true" /> researching now
      </span>
    )
  }
  const benched = status.models.filter((m) => m.benchedUntil)
  if (status.models.length > 0 && benched.length === status.models.length) {
    const next = benched.map((m) => m.benchedUntil as string).sort()[0]
    return (
      <span className="chip chip-warn" title={benched.map((m) => `${m.id}: ${m.reason}`).join('\n')}>
        out of free quota until {clockTime(next)}
      </span>
    )
  }
  if (status.queuedCount > 0) return <span className="chip">{status.queuedCount} in queue</span>
  return <span className="chip chip-idle">idle</span>
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
