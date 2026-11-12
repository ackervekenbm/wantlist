import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Idea, ServerStatus } from '../../types'
import { clockTime } from '../lib/format'
import { idea, pick, status } from '../test/fakeApi'
import { HomeScreen } from './HomeScreen'

const IDEAS: Idea[] = [
  idea({ id: 1, title: 'Quiet trainer fan', picks: [pick({ id: 1, reaction: 'yes' }), pick({ id: 2 }), pick({ id: 3 })] }),
  idea({ id: 2, title: 'Wool slippers', round: 2, status: 'error', errorKind: 'nothing-new', picks: [] }),
  idea({ id: 3, text: 'citrus press', title: null, round: 0, status: 'error', errorKind: 'stopped', picks: [] }),
  idea({ id: 4, text: 'iPhone case', title: 'Model title', round: 0, status: 'researching', picks: [] }),
  idea({ id: 5, text: 'desk lamp', round: 0, status: 'queued', picks: [] }),
  idea({ id: 6, text: 'rain jacket', round: 0, status: 'queued', nextAttemptAt: '2026-11-12T15:30:00', picks: [] }),
  idea({ id: 7, title: 'Sorted already', picks: [pick({ id: 7, reaction: 'no' })] }),
  idea({ id: 8, list: 'bought', title: 'Bought thing' }),
  idea({ id: 9, list: 'archived', title: 'Archived thing' }),
]

function renderHome(over: { ideas?: Idea[]; status?: ServerStatus | null; selectedId?: number | null } = {}) {
  const props = {
    ideas: IDEAS,
    status: status({ running: true, current: { ideaId: 4, step: 'reading 11 shop pages' } }),
    selectedId: null,
    onOpen: vi.fn(),
    onLists: vi.fn(),
    onAdd: vi.fn(async () => {}),
    ...over,
  }
  render(<HomeScreen {...props} />)
  return { ...props, user: userEvent.setup() }
}

const row = (id: number) => document.querySelector<HTMLElement>(`[data-idea-id="${id}"]`) as HTMLElement

describe('HomeScreen', () => {
  it('lists what needs you, with a leader line each', () => {
    renderHome()
    const needs = screen.getByRole('region', { name: /Needs you/ })
    expect(within(needs).getAllByRole('button').map((b) => b.dataset.ideaId)).toEqual(['1', '2', '3'])
    expect(row(1)).toHaveTextContent(/Quiet trainer fan.*React · round 1.*2 new picks/)
    expect(row(2)).toHaveTextContent(/Wool slippers.*Nothing new found.*round 3/)
    expect(row(3)).toHaveTextContent(/citrus press.*Stopped.*try again/)
  })

  it('lists what is with the researcher, with the live step, queued or the retry time', () => {
    renderHome()
    const waiting = screen.getByRole('region', { name: /With the researcher/ })
    expect(within(waiting).getAllByRole('button').map((b) => b.dataset.ideaId)).toEqual(['4', '5', '6'])
    expect(row(4)).toHaveTextContent(/iPhone case.*reading 11 shop pages/)
    expect(row(5)).toHaveTextContent(/desk lamp.*queued/)
    expect(row(6)).toHaveTextContent(`rain jacket retrying around ${clockTime('2026-11-12T15:30:00')}`)
    expect(row(7)).toBeNull()
  })

  it('says so when nothing needs you', () => {
    renderHome({ ideas: IDEAS.slice(3) })
    expect(screen.getByText(/Nothing needs you/)).toBeInTheDocument()
  })

  it('counts each list on a tile that opens it', async () => {
    const { user, onLists } = renderHome()
    const tiles = screen.getByRole('navigation', { name: 'Lists' })
    expect(within(tiles).getAllByRole('button').map((b) => b.textContent)).toEqual([
      '7 Wanted',
      '1 Bought',
      '1 Archived',
    ])
    await user.click(within(tiles).getByRole('button', { name: '1 Bought' }))
    expect(onLists).toHaveBeenCalledWith('bought')
  })

  it('opens an idea from its row and marks the selected one', async () => {
    const { user, onOpen } = renderHome({ selectedId: 2 })
    await user.click(row(1))
    expect(onOpen).toHaveBeenCalledWith(1)
    expect(row(2)).toHaveAttribute('aria-current', 'true')
    expect(row(1)).not.toHaveAttribute('aria-current')
  })

  it('adds with Enter', async () => {
    const { user, onAdd } = renderHome()
    await user.type(screen.getByLabelText('What do you want?'), 'Running shoes{Enter}')
    expect(onAdd).toHaveBeenCalledWith({ text: 'Running shoes', budget: null, notes: null })
    expect(screen.getByLabelText('What do you want?')).toHaveValue('')
  })

  it('shows the banners for research off and out of quota', () => {
    renderHome({ status: status({ researchEnabled: false, missingKeys: ['SERPER_API_KEY'], models: [] }) })
    expect(screen.getByText(/SERPER_API_KEY is missing on the server/)).toBeInTheDocument()
  })

  it('says when every model is out of quota', () => {
    renderHome({ status: status({ models: [{ id: 'a', benchedUntil: '2026-11-12T09:00:00', reason: 'quota' }] }) })
    expect(screen.getByRole('status')).toHaveTextContent(`Research picks up again around ${clockTime('2026-11-12T09:00:00')}.`)
  })

  it('welcomes you with zero ideas', () => {
    renderHome({ ideas: [] })
    expect(screen.getByText('Nothing on the list.')).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Lists' })).not.toBeInTheDocument()
  })
})
