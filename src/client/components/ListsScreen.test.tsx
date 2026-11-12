import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Idea, IdeaList } from '../../types'
import { idea } from '../test/fakeApi'
import { ListsScreen } from './ListsScreen'

function setup(ideas: Idea[], tab: IdeaList = 'wanted') {
  const h = {
    onTab: vi.fn(),
    onOpen: vi.fn(),
    onPatch: vi.fn(),
    onRemove: vi.fn(),
  }
  render(<ListsScreen ideas={ideas} tab={tab} {...h} />)
  return { ...h, user: userEvent.setup() }
}

describe('ListsScreen', () => {
  it('shows counts on the tabs and switches tab', async () => {
    const { user, onTab } = setup([idea({ id: 1 }), idea({ id: 2, list: 'archived' })])
    expect(screen.getByRole('button', { name: /^Wanted\s*1$/ })).toHaveAttribute('aria-pressed', 'true')
    await user.click(screen.getByRole('button', { name: /^Archived\s*1$/ }))
    expect(onTab).toHaveBeenCalledWith('archived')
  })

  it('opens an idea from its row', async () => {
    const { user, onOpen } = setup([idea({ id: 7, title: 'Quiet fan' })])
    await user.click(screen.getByRole('button', { name: /^Quiet fan/ }))
    expect(onOpen).toHaveBeenCalledWith(7)
  })

  it('has no filter box on a short list', () => {
    setup([idea({ id: 1 })])
    expect(screen.queryByLabelText('Filter ideas')).not.toBeInTheDocument()
  })

  it('filters a long list', async () => {
    const { user } = setup(
      Array.from({ length: 9 }, (_, i) => idea({ id: i + 1, title: i === 4 ? 'Standing desk' : `Idea ${i}` })),
    )
    const box = screen.getByLabelText('Filter ideas')
    await user.type(box, 'desk')
    expect(screen.getAllByRole('button', { name: /^Archive / })).toHaveLength(1)
    await user.clear(box)
    await user.type(box, 'zzz')
    expect(screen.getByText('Nothing matches that filter.')).toBeInTheDocument()
  })

  it('archives from Wanted', async () => {
    const { user, onPatch } = setup([idea({ id: 3, title: 'Fan' })])
    await user.click(screen.getByRole('button', { name: 'Archive Fan' }))
    expect(onPatch).toHaveBeenCalledWith(3, { list: 'archived' })
  })

  it('wants again and removes from Archived', async () => {
    const { user, onPatch, onRemove } = setup([idea({ id: 3, title: 'Fan', list: 'archived' })], 'archived')
    await user.click(screen.getByRole('button', { name: 'Want Fan again' }))
    expect(onPatch).toHaveBeenCalledWith(3, { list: 'wanted' })
    await user.click(screen.getByRole('button', { name: 'Remove Fan' }))
    expect(onRemove).toHaveBeenCalledWith(3)
  })

  it('reads a Bought row as what, where, price, when', () => {
    const bought = {
      title: 'Wahoo KICKR Headwind',
      shop: 'Bikeshop',
      url: 'https://x.be',
      price: 249.99,
      at: '2026-09-28T10:00:00Z',
    }
    setup([idea({ id: 1, list: 'bought', bought }), idea({ id: 2, list: 'bought', bought: null })], 'bought')
    expect(screen.getByText(/^Wahoo KICKR Headwind · Bikeshop · €\s249,99 · 28 Sep/)).toBeInTheDocument()
    const rows = screen.getAllByRole('button', { name: /^Want / })
    expect(rows).toHaveLength(2)
    expect(within(document.body).getByText('Bought something else')).toBeInTheDocument()
  })
})
