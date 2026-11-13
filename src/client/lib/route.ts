import { useEffect, useState } from 'react'
import type { IdeaList } from '../../types'

// A hash router: #/, #/idea/<id>, #/lists/<wanted|bought|archived>.

export type Route = { name: 'home' } | { name: 'idea'; id: number } | { name: 'lists'; tab: IdeaList }

const LISTS: readonly IdeaList[] = ['wanted', 'bought', 'archived']

export function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '')
  const idea = /^\/idea\/([1-9]\d*)$/.exec(path)
  if (idea) return { name: 'idea', id: Number(idea[1]) }
  const lists = /^\/lists\/(\w+)$/.exec(path)
  if (lists && (LISTS as readonly string[]).includes(lists[1])) return { name: 'lists', tab: lists[1] as IdeaList }
  return { name: 'home' }
}

export function toHash(route: Route): string {
  if (route.name === 'idea') return `#/idea/${route.id}`
  if (route.name === 'lists') return `#/lists/${route.tab}`
  return '#/'
}

export type Navigate = (route: Route, opts?: { replace?: boolean }) => void

/** pushState and replaceState fire no hashchange, so navigate announces itself with this. */
const MOVED = 'wantlist:route'

/**
 * Pushes (or replaces) the route. A pushed entry remembers the hash it was
 * opened from, so `goHome` knows whether Back would land on home.
 */
export const navigate: Navigate = (next, opts) => {
  const hash = toHash(next)
  if (hash === toHash(parseHash(location.hash))) return
  if (opts?.replace) history.replaceState(history.state, '', hash)
  else history.pushState({ from: toHash(parseHash(location.hash)) }, '', hash)
  window.dispatchEvent(new Event(MOVED))
}

/**
 * The in-app way home: steps back when the entry before this one is home,
 * so the system Back gesture never reopens the screen just left; else
 * replaces this entry with home.
 */
export function goHome(): void {
  const from: unknown = (history.state as { from?: unknown } | null)?.from
  if (from === '#/') history.back()
  else navigate({ name: 'home' }, { replace: true })
}

export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState(() => parseHash(location.hash))

  useEffect(() => {
    // The same hash keeps the same object, so nothing downstream re-runs for it.
    const follow = () => {
      const next = parseHash(location.hash)
      setRoute((prev) => (toHash(prev) === toHash(next) ? prev : next))
    }
    const events = ['hashchange', 'popstate', MOVED]
    for (const e of events) window.addEventListener(e, follow)
    return () => {
      for (const e of events) window.removeEventListener(e, follow)
    }
  }, [])

  return [route, navigate]
}
