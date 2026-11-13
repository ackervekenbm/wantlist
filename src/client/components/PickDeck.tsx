import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import type { Idea, Pick, PickPatch, Reaction } from '../../types'
import { latestPicks } from '../lib/triage'
import { PickCard } from './PickCard'
import { ReactionBar } from './ReactionBar'

interface Props {
  idea: Idea
  onReact: (pickId: number, patch: PickPatch) => Promise<void>
  onBought: (pick: Pick) => void
}

const ADVANCE_MS = 250
const SWIPE_PX = 90
/** Movement past this is a drag, not a tap: the click after it is swallowed. */
const DRAG_PX = 24
const LABEL: Record<Reaction, string> = { no: 'No way', maybe: 'Kind of', yes: 'Yes' }

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false

/** The pick after `fromId` (wrapping) that has no reaction yet, treating `fromId` as reacted; else the end card. */
function nextUnreacted(picks: Pick[], fromId: number): number | 'end' {
  const i = picks.findIndex((p) => p.id === fromId)
  return [...picks.slice(i + 1), ...picks.slice(0, i)].find((p) => !p.reaction)?.id ?? 'end'
}

/**
 * The newest round, one card at a time. The parent keys it by idea and round,
 * so a new round starts at its first unreacted pick.
 */
export function PickDeck({ idea, onReact, onBought }: Props) {
  const picks = latestPicks(idea)
  const wanted = idea.list === 'wanted'
  // A pick id, not an index, so a poll can't move it.
  const [at, setAt] = useState<number | 'end'>(() => (picks.find((p) => !p.reaction) ?? picks[0])?.id ?? 'end')
  // The Yes / Kind of waiting to advance; dropped if the reaction rolls back.
  const [pending, setPending] = useState<{ id: number; reaction: Reaction } | null>(null)
  const picksRef = useRef(picks)
  const cardRef = useRef<HTMLElement>(null)
  const moved = useRef(false)
  const drag = useRef<{ x: number; y: number } | null>(null)
  const dragged = useRef(false)

  const pick = at === 'end' ? undefined : (picks.find((p) => p.id === at) ?? picks[0])
  const n = pick ? picks.indexOf(pick) : picks.length
  const live = pending && picks.find((p) => p.id === pending.id)?.reaction === pending.reaction ? pending : null

  useEffect(() => {
    picksRef.current = picks
  })
  useEffect(() => {
    if (!live) return
    const timer = setTimeout(() => {
      moved.current = true
      setPending(null)
      setAt(nextUnreacted(picksRef.current, live.id))
    }, ADVANCE_MS)
    return () => clearTimeout(timer)
  }, [live])
  // After an advance or an arrow key the focused card or keycap is gone: hand focus to the new card.
  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    if (document.activeElement === document.body) cardRef.current?.focus()
  }, [at])

  if (picks.length === 0) return null
  const round = picks[0].round

  const go = (id: number | 'end') => {
    setPending(null)
    setAt(id)
  }
  const advance = (fromId: number) => {
    moved.current = true
    go(nextUnreacted(picks, fromId))
  }
  const react = (p: Pick, patch: PickPatch) => {
    const done = onReact(p.id, patch)
    const r = patch.reaction
    if (r === 'yes' || r === 'maybe') {
      if (reducedMotion()) advance(p.id)
      else setPending({ id: p.id, reaction: r })
    }
    return done
  }

  const swipe = {
    onPointerDown: (e: PointerEvent) => {
      dragged.current = false
      drag.current = e.pointerType === 'touch' || e.pointerType === 'pen' ? { x: e.clientX, y: e.clientY } : null
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!drag.current || reducedMotion()) return
      const dx = e.clientX - drag.current.x
      if (Math.abs(dx) > Math.abs(e.clientY - drag.current.y)) {
        e.currentTarget.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg)`
      }
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const start = drag.current
      drag.current = null
      e.currentTarget.style.transform = ''
      if (!start || !pick || !wanted) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      dragged.current = Math.hypot(dx, dy) > DRAG_PX
      // Only the click this pointerup produces is swallowed, never a later one (keyboard Enter).
      setTimeout(() => (dragged.current = false))
      const r = dx > 0 ? 'yes' : 'no'
      if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) && pick.reaction !== r) {
        react(pick, { reaction: r }).catch(() => {})
      }
    },
    onPointerCancel: (e: PointerEvent<HTMLElement>) => {
      drag.current = null
      e.currentTarget.style.transform = ''
    },
    onClickCapture: (e: MouseEvent) => {
      if (!dragged.current) return
      dragged.current = false
      e.preventDefault()
      e.stopPropagation()
    },
  }

  const tally = (r: Reaction) => picks.filter((p) => p.reaction === r).length
  const reacted = picks.filter((p) => p.reaction).length

  return (
    <div
      className="deck-wrap"
      onKeyDown={(e) => {
        if (e.target instanceof HTMLInputElement || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
        const to = n + (e.key === 'ArrowRight' ? 1 : -1)
        if (to < 0 || to >= picks.length) return
        e.preventDefault()
        moved.current = true
        go(picks[to].id)
      }}
    >
      <div className="roundbar">
        <span className="lab">R{round}</span>
        <div className="pips" role="group" aria-label={`Picks in round ${round}`}>
          {picks.map((p, j) => (
            <button
              key={p.id}
              type="button"
              className={`pip ${p.reaction ?? ''}`}
              aria-current={j === n}
              aria-label={`Pick ${j + 1}${p.reaction ? `, ${LABEL[p.reaction]}` : ''}`}
              onClick={() => go(p.id)}
            >
              <i>{j + 1}</i>
            </button>
          ))}
        </div>
        <span className="tally">
          {reacted} of {picks.length}
        </span>
      </div>
      <p className="visually-hidden" aria-live="polite">
        {pick ? `Pick ${n + 1} of ${picks.length}` : `Round ${round} sorted`}
      </p>

      <div className="deck">
        {pick ? (
          <article
            key={pick.id}
            ref={cardRef}
            tabIndex={0}
            className={`card pick in${live?.id === pick.id ? ` out-${live.reaction === 'yes' ? 'r' : 'l'}` : ''}`}
            aria-label={`Pick ${n + 1} of ${picks.length}`}
            {...swipe}
          >
            <PickCard pick={pick} budget={idea.budget} onBought={wanted ? () => onBought(pick) : undefined} />
          </article>
        ) : (
          <section className="card endcard" ref={cardRef} tabIndex={-1}>
            <h3>Round {round} sorted</h3>
            <p>
              {tally('yes')} yes · {tally('maybe')} kind of · {tally('no')} no way
            </p>
            <button type="button" className="btn" onClick={() => go(picks[0].id)}>
              Look again
            </button>
          </section>
        )}
      </div>

      {pick && wanted && (
        <>
          <ReactionBar
            key={pick.id}
            title={pick.title}
            reaction={pick.reaction}
            reason={pick.reason}
            onReact={(patch) => react(pick, patch)}
            onNext={() => advance(pick.id)}
          />
          {pick.reaction !== 'no' && (
            <p className="keyhint">Tap again to clear · swipe the card: left No way, right Yes</p>
          )}
        </>
      )}
    </div>
  )
}
