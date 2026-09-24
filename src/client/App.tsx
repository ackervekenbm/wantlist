import { useCallback, useEffect, useRef, useState } from 'react'
import type { Idea } from '../types'
import { addIdea, deleteIdea, getStatus, listIdeas, rerunIdea } from './api'
import { CaptureBox } from './components/CaptureBox'
import { IdeaCard } from './components/IdeaCard'
import type { WorkerRuntime } from '../types'

interface AppState {
  ideas: Idea[]
  loaded: boolean
  error: string | null
  status: WorkerRuntime | null
}

const POLL_MS = 8000

export function App() {
  const [state, setState] = useState<AppState>({
    ideas: [],
    loaded: false,
    error: null,
    status: null,
  })
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const refresh = useCallback(async (quiet = false) => {
    try {
      const [ideas, status] = await Promise.all([listIdeas(), getStatus()])
      setState({ ideas, loaded: true, error: null, status })
    } catch (err) {
      if (!quiet) setState((s) => ({ ...s, error: (err as Error).message }))
    }
  }, [])

  useEffect(() => {
    void refresh()
    timer.current = setInterval(() => void refresh(true), POLL_MS)
    return () => {
      if (timer.current) clearInterval(timer.current)
    }
  }, [refresh])

  const handleAdd = async (text: string) => {
    await addIdea(text)
    await refresh()
  }

  const handleDelete = async (id: number) => {
    await deleteIdea(id)
    await refresh()
  }

  const handleRerun = async (id: number) => {
    await rerunIdea(id)
    await refresh()
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-mark">w</span>
          <span className="wordmark-text">wantlist</span>
        </div>
        <div className="topbar-meta">
          {state.status?.running ? (
            <span className="chip chip-live">researching now</span>
          ) : state.status?.queuedCount ? (
            <span className="chip">{state.status.queuedCount} in queue</span>
          ) : (
            <span className="chip chip-idle">idle</span>
          )}
        </div>
      </header>

      <main className="content">
        {state.error && (
          <div className="banner" role="alert">
            {state.error}
            <button className="banner-close" onClick={() => setState((s) => ({ ...s, error: null }))}>
              dismiss
            </button>
          </div>
        )}

        <CaptureBox onAdd={handleAdd} />

        {!state.loaded ? (
          <div className="skeleton" aria-label="loading">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-card" />
            ))}
          </div>
        ) : state.ideas.length === 0 ? (
          <EmptyState />
        ) : (
          <section className="ideas">
            <h2 className="section-label">your list</h2>
            {state.ideas.map((idea) => (
              <IdeaCard
                key={idea.id}
                idea={idea}
                onDelete={() => void handleDelete(idea.id)}
                onRerun={() => void handleRerun(idea.id)}
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
}

function EmptyState() {
  return (
    <div className="empty">
      <div className="empty-glyph">✥</div>
      <p className="empty-title">Nothing on the list.</p>
      <p className="empty-sub">
        Type something you've been meaning to buy. The app researches it in the background and
        comes back with candidates, shops and links — checked when you feel like it.
      </p>
    </div>
  )
}