import { useEffect, useRef, useState } from 'react'
import { HomeScreen, Skeleton } from './components/HomeScreen'
import { IdeaScreen } from './components/IdeaScreen'
import { shownTitle } from './lib/triage'
import { ListsScreen } from './components/ListsScreen'
import { Shell } from './components/Shell'
import { TopBar } from './components/TopBar'
import { useIdeas } from './hooks/useIdeas'
import { useRoute, type Route } from './lib/route'
import { applyTheme, readTheme, writeTheme, type Theme } from './lib/theme'

export function App() {
  const state = useIdeas()
  const [route, navigate] = useRoute()
  const [theme, setTheme] = useState<Theme>(readTheme)

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
        currentTitle={current ? shownTitle(current) : null}
        theme={theme}
        onTheme={(t) => {
          writeTheme(t)
          applyTheme(t)
          setTheme(t)
        }}
      />

      <HomeScreen
        loaded={state.loaded}
        ideas={state.ideas}
        status={state.status}
        selectedId={route.name === 'idea' ? route.id : null}
        selectedList={route.name === 'lists' ? route.tab : null}
        onOpen={(id) => navigate({ name: 'idea', id })}
        onLists={(tab) => navigate({ name: 'lists', tab })}
        onAdd={state.add}
      />
    </div>
  )

  const right = !state.loaded ? (
    <div className="screen" aria-busy="true">
      <Skeleton />
    </div>
  ) : route.name === 'lists' ? (
    <ListsScreen
      ideas={state.ideas}
      tab={route.tab}
      onTab={(tab) => navigate({ name: 'lists', tab }, { replace: true })}
      onOpen={(id) => navigate({ name: 'idea', id })}
      // run() already put the failure in the banner
      onPatch={(id, patch) => void state.patch(id, patch).catch(() => {})}
      onRemove={state.remove}
    />
  ) : openIdea ? (
    <IdeaScreen
      key={openIdea.id}
      idea={openIdea}
      status={state.status}
      // Archive and Remove leave no entry behind for an idea that is gone from view.
      onBack={() => navigate({ name: 'home' }, { replace: true })}
      actions={state}
    />
  ) : null

  return (
    <Shell
      route={route}
      left={left}
      right={right}
      banner={
        state.error && (
          <div className="banner" role="alert">
            <span>{state.error}</span>
            <button type="button" className="banner-close" onClick={state.dismissError}>
              Dismiss
            </button>
          </div>
        )
      }
      toast={
        state.removed && (
          <div className="toast" role="status">
            <span>Removed “{truncate(state.removed.text, 40)}”</span>
            <button type="button" onClick={state.undoRemove}>
              Undo
            </button>
          </div>
        )
      }
    />
  )
}

/**
 * Opening an idea or the lists focuses that screen's h1 and scrolls to the
 * top; a tab switch on the lists leaves focus on the tab. Going back home
 * returns focus to the idea's row, else to home's h1.
 */
function useRouteFocus(route: Route, loaded: boolean) {
  const previous = useRef(route)
  useEffect(() => {
    const prev = previous.current
    previous.current = route
    if (route.name === 'home') {
      if (prev.name === 'home') return
      const row = prev.name === 'idea' && document.querySelector<HTMLElement>(`.pane-left [data-idea-id="${prev.id}"]`)
      ;(row || document.querySelector<HTMLElement>('.pane-left h1'))?.focus()
      return
    }
    if (prev !== route && prev.name === 'lists' && route.name === 'lists') return
    const h1 = document.querySelector<HTMLElement>('.pane-right h1')
    if (!h1) return
    h1.focus({ preventScroll: true })
    // Below 900 px the document scrolls, from 900 px the pane; resetting both is right in either layout.
    document.documentElement.scrollTop = 0
    const pane = h1.closest<HTMLElement>('.pane')
    if (pane) pane.scrollTop = 0
  }, [route, loaded])
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
