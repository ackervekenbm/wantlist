import { useCallback, useEffect, useState } from 'react'
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

export function useRoute(): [Route, Navigate] {
  const [route, setRoute] = useState(() => parseHash(location.hash))

  useEffect(() => {
    const follow = () => setRoute(parseHash(location.hash))
    window.addEventListener('hashchange', follow)
    return () => window.removeEventListener('hashchange', follow)
  }, [])

  const navigate = useCallback<Navigate>((next, opts) => {
    if (opts?.replace) {
      // replaceState fires no hashchange, so update the state here.
      history.replaceState(history.state, '', toHash(next))
      setRoute(next)
    } else {
      location.hash = toHash(next)
    }
  }, [])

  return [route, navigate]
}
