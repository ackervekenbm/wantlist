import { useCallback, useEffect, useRef, useState } from 'react'
import type { Idea, IdeaPatch, NewIdea, Pick, PickPatch, ServerStatus } from '../../types'
import * as api from '../api'

/** Poll this often while research is queued or running... */
export const BUSY_POLL_MS = 5_000
/** ...and this often otherwise (a retry may come due, another device may add ideas). */
export const IDLE_POLL_MS = 60_000
/** How long a removed idea can be brought back. */
export const UNDO_MS = 6_000

export interface IdeasState {
  ideas: Idea[]
  status: ServerStatus | null
  loaded: boolean
  error: string | null
  /** The idea removed last, while it can still be undone. */
  removed: Idea | null
}

export interface IdeasActions {
  add(idea: NewIdea): Promise<void>
  patch(id: number, patch: IdeaPatch): Promise<void>
  rerun(id: number): Promise<void>
  /** Reacts to a pick: shown at once, rolled back if the server refuses. */
  react(pickId: number, patch: PickPatch): Promise<void>
  /** Researches another round from the reactions and preferences. */
  refine(id: number): Promise<void>
  /** Hides the idea now and deletes it once the undo window has passed. */
  remove(id: number): void
  undoRemove(): void
  dismissError(): void
}

function isBusy(ideas: Idea[], status: ServerStatus | null): boolean {
  if (status?.running) return true
  return ideas.some((i) => i.list === 'wanted' && (i.status === 'researching' || (i.status === 'queued' && !i.nextAttemptAt)))
}

export function useIdeas(): IdeasState & IdeasActions {
  const [ideas, setIdeas] = useState<Idea[]>([])
  const [status, setStatus] = useState<ServerStatus | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removed, setRemoved] = useState<Idea | null>(null)
  const ideasRef = useRef<Idea[]>([])
  useEffect(() => {
    ideasRef.current = ideas
  }, [ideas])
  const writeSeq = useRef(0)
  const pickSeq = useRef(new Map<number, number>())
  const pendingDelete = useRef<{ id: number; timer: ReturnType<typeof setTimeout> } | null>(null)

  const refresh = useCallback(async (quiet = false) => {
    const seq = writeSeq.current
    try {
      const [nextIdeas, nextStatus] = await Promise.all([api.listIdeas(), api.getStatus()])
      // A write started meanwhile: this answer predates it.
      if (seq !== writeSeq.current) return
      const hidden = pendingDelete.current?.id
      setIdeas(hidden ? nextIdeas.filter((i) => i.id !== hidden) : nextIdeas)
      setStatus(nextStatus)
      setLoaded(true)
      setError(null)
    } catch (err) {
      if (!quiet) setError((err as Error).message)
    }
  }, [])

  // Initial load, then poll at a pace that follows the work in flight.
  const busy = isBusy(ideas, status)
  useEffect(() => {
    void refresh()
  }, [refresh])
  useEffect(() => {
    const timer = setInterval(() => void refresh(true), busy ? BUSY_POLL_MS : IDLE_POLL_MS)
    return () => clearInterval(timer)
  }, [busy, refresh])

  // Coming back to the tab shows fresh results at once.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh(true)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [refresh])

  const flushDelete = useCallback((keepalive = false) => {
    const pending = pendingDelete.current
    if (!pending) return
    clearTimeout(pending.timer)
    pendingDelete.current = null
    setRemoved(null)
    void api.deleteIdea(pending.id, { keepalive }).catch((err: Error) => setError(err.message))
  }, [])

  // Closing the tab inside the undo window still deletes.
  useEffect(() => {
    const onHide = () => flushDelete(true)
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
    }
  }, [flushDelete])

  const replace = (idea: Idea) => setIdeas((list) => list.map((i) => (i.id === idea.id ? idea : i)))

  const run = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (err) {
      setError((err as Error).message)
      throw err
    }
  }, [])

  return {
    ideas,
    status,
    loaded,
    error,
    removed,
    add: async (idea) => {
      // The capture box shows its own error, so this one stays quiet.
      writeSeq.current++
      const created = await api.addIdea(idea)
      setIdeas((list) => [created, ...list])
      void refresh(true)
    },
    patch: (id, patch) =>
      run(async () => {
        writeSeq.current++
        replace(await api.patchIdea(id, patch))
      }),
    rerun: (id) =>
      run(async () => {
        writeSeq.current++
        replace(await api.rerunIdea(id))
        void refresh(true)
      }),
    refine: (id) =>
      run(async () => {
        writeSeq.current++
        replace(await api.refineIdea(id))
        void refresh(true)
      }),
    react: (pickId, patch) =>
      run(async () => {
        writeSeq.current++
        const seq = (pickSeq.current.get(pickId) ?? 0) + 1
        pickSeq.current.set(pickId, seq)
        const before = ideasRef.current.flatMap((i) => i.picks).find((p) => p.id === pickId)
        const apply = (reaction: Pick['reaction'], reason: Pick['reason']) =>
          setIdeas((list) =>
            list.map((i) => ({ ...i, picks: i.picks.map((p) => (p.id === pickId ? { ...p, reaction, reason } : p)) })),
          )
        const reaction = patch.reaction !== undefined ? patch.reaction : before?.reaction ?? null
        const dropsReason = reaction === null || (patch.reaction !== undefined && reaction !== 'no' && patch.reason === undefined)
        apply(reaction, dropsReason ? null : patch.reason !== undefined ? patch.reason : before?.reason ?? null)
        try {
          const updated = await api.patchPick(pickId, patch)
          if (pickSeq.current.get(pickId) === seq) replace(updated)
        } catch (err) {
          if (pickSeq.current.get(pickId) === seq && before) apply(before.reaction, before.reason)
          throw err
        }
      }),
    remove: (id) => {
      flushDelete()
      const idea = ideas.find((i) => i.id === id) ?? null
      setIdeas((list) => list.filter((i) => i.id !== id))
      setRemoved(idea)
      pendingDelete.current = { id, timer: setTimeout(() => flushDelete(), UNDO_MS) }
    },
    undoRemove: () => {
      const pending = pendingDelete.current
      if (!pending) return
      clearTimeout(pending.timer)
      pendingDelete.current = null
      if (removed) setIdeas((list) => [...list, removed].sort((a, b) => b.id - a.id))
      setRemoved(null)
    },
    dismissError: () => setError(null),
  }
}
