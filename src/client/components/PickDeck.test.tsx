import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Idea } from '../../types'
import { App } from '../App'
import { BUSY_POLL_MS } from '../hooks/useIdeas'
import { fakeApi, idea, pick, status } from '../test/fakeApi'
import { PickDeck } from './PickDeck'

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

const three = (over: Array<Partial<ReturnType<typeof pick>>> = []) =>
  idea({
    picks: [
      pick({ id: 1, rank: 1, title: 'Alpha', ...over[0] }),
      pick({ id: 2, rank: 2, title: 'Bravo', ...over[1] }),
      pick({ id: 3, rank: 3, title: 'Charlie', ...over[2] }),
    ],
  })

/** The app on idea 1, once the ideas have loaded. */
async function open(ideas: Idea[], serverStatus = status()) {
  const api = fakeApi(ideas, serverStatus)
  history.replaceState(null, '', '#/idea/1')
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
  render(<App />)
  await waitFor(() => expect(document.querySelector('.deck')).not.toBeNull())
  return { api, user }
}

const deck = () => within(document.querySelector('.deck-wrap') as HTMLElement)
/** The title on the pick card now showing, or null on the end card. */
const current = () => document.querySelector('.deck .pick-title')?.textContent ?? null
const keys = (title: string) => within(screen.getByRole('group', { name: `Your reaction to ${title}` }))
const pip = (n: number) => deck().getByRole('button', { name: new RegExp(`^Pick ${n}\\b`) })
const wait = (ms: number) =>
  act(async () => {
    vi.advanceTimersByTime(ms)
  })

describe('PickDeck moves', () => {
  it('advances to the next unreacted pick after Yes, once the timer runs', async () => {
    const { user } = await open([three([{}, { reaction: 'maybe' }])])
    expect(current()).toBe('Alpha')
    expect(pip(1)).toHaveAttribute('aria-current', 'true')
    await user.click(keys('Alpha').getByRole('button', { name: 'Yes' }))
    expect(current()).toBe('Alpha')
    expect(document.querySelector('.deck .pick')).toHaveClass('out-r')
    await wait(250)
    // Bravo already has a reaction, so the deck skips to Charlie.
    expect(current()).toBe('Charlie')
    expect(pip(3)).toHaveAttribute('aria-current', 'true')
    expect(deck().getByText('Pick 3 of 3')).toBeInTheDocument()
  })

  it('a rollback inside the 250 ms cancels the advance', async () => {
    const { api, user } = await open([three()])
    api.failNextPickPatch()
    const yes = keys('Alpha').getByRole('button', { name: 'Yes' })
    await user.click(yes)
    await waitFor(() => expect(yes).toHaveAttribute('aria-pressed', 'false'))
    await wait(500)
    expect(current()).toBe('Alpha')
  })

  it('a poll keeps the pick you are on', async () => {
    const { api, user } = await open([three()], status({ running: true }))
    await user.click(pip(2))
    expect(current()).toBe('Bravo')
    const before = api.calls.filter((c) => c.path === '/api/ideas').length
    await wait(BUSY_POLL_MS + 10)
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/api/ideas').length).toBeGreaterThan(before))
    expect(current()).toBe('Bravo')
  })
})

describe('No way and why-not', () => {
  it('stays on the pick and saves the reason once, on Enter then blur', async () => {
    const { api, user } = await open([three()])
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    await wait(500)
    expect(current()).toBe('Alpha')
    const why = screen.getByRole('textbox', { name: 'Why not Alpha?' })
    expect(why).toHaveFocus()
    await user.type(why, 'too loud{Enter}')
    await user.tab()
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no' } },
        { method: 'PATCH', path: '/api/picks/1', body: { reason: 'too loud' } },
      ]),
    )
  })

  it('a reason typed on one pick goes to that pick when a pip jumps away', async () => {
    const { api, user } = await open([three()])
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    await user.type(screen.getByRole('textbox', { name: 'Why not Alpha?' }), 'meh')
    await user.click(pip(2))
    expect(current()).toBe('Bravo')
    expect(screen.queryByRole('textbox', { name: /Why not/ })).not.toBeInTheDocument()
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no' } },
        { method: 'PATCH', path: '/api/picks/1', body: { reason: 'meh' } },
      ]),
    )
  })

  it('a quick chip saves its text once and fills the input', async () => {
    const { api, user } = await open([three()])
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    const chip = screen.getByRole('button', { name: 'Too expensive' })
    await user.click(chip)
    expect(screen.getByRole('textbox', { name: 'Why not Alpha?' })).toHaveValue('Too expensive')
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    await user.click(chip)
    await user.click(screen.getByRole('textbox', { name: 'Why not Alpha?' }))
    await user.tab()
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no' } },
        { method: 'PATCH', path: '/api/picks/1', body: { reason: 'Too expensive' } },
      ]),
    )
  })

  it('a chip tapped after typing saves only the chip text', async () => {
    const { api, user } = await open([three()])
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    await user.type(screen.getByRole('textbox', { name: 'Why not Alpha?' }), 'meh')
    await user.click(screen.getByRole('button', { name: 'Not my style' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no' } },
        { method: 'PATCH', path: '/api/picks/1', body: { reason: 'Not my style' } },
      ]),
    )
  })

  it('Next saves the reason and moves on', async () => {
    const { api, user } = await open([three()])
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    await user.type(screen.getByRole('textbox', { name: 'Why not Alpha?' }), 'ugly')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(current()).toBe('Bravo')
    await waitFor(() => expect(api.writes()).toHaveLength(2))
    expect(api.writes()[1]).toEqual({ method: 'PATCH', path: '/api/picks/1', body: { reason: 'ugly' } })
  })

  it('tapping the active reaction clears it and its reason', async () => {
    const { api, user } = await open([three([{ reaction: 'no', reason: 'too loud' }])])
    expect(current()).toBe('Bravo')
    await user.click(pip(1))
    await user.click(keys('Alpha').getByRole('button', { name: 'No way' }))
    await wait(500)
    expect(current()).toBe('Alpha')
    expect(screen.queryByRole('textbox', { name: /Why not/ })).not.toBeInTheDocument()
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/picks/1', body: { reaction: null, reason: null } }])
  })
})

describe('Deck navigation', () => {
  it('pips jump, and the arrow keys move while the card has focus', async () => {
    const { user } = await open([three()])
    await user.click(pip(3))
    expect(current()).toBe('Charlie')
    expect(pip(3)).toHaveAttribute('aria-current', 'true')
    expect(pip(1)).toHaveAttribute('aria-current', 'false')
    ;(document.querySelector('.deck .pick') as HTMLElement).focus()
    await user.keyboard('{ArrowLeft}')
    expect(current()).toBe('Bravo')
    await user.keyboard('{ArrowRight}')
    expect(current()).toBe('Charlie')
  })

  it('shows the end card with the tally after the last pick; Look again goes to pick 1 without a write', async () => {
    const { api, user } = await open([three([{ reaction: 'yes' }, { reaction: 'no' }])])
    expect(current()).toBe('Charlie')
    await user.click(keys('Charlie').getByRole('button', { name: 'Yes' }))
    await wait(250)
    expect(current()).toBeNull()
    expect(deck().getByRole('heading', { name: 'Round 1 sorted' })).toBeInTheDocument()
    expect(deck().getByText('2 yes · 0 kind of · 1 no way')).toBeInTheDocument()
    expect(deck().queryByRole('button', { name: /Refine/ })).not.toBeInTheDocument()
    await user.click(deck().getByRole('button', { name: 'Look again' }))
    expect(current()).toBe('Alpha')
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/picks/3', body: { reaction: 'yes' } }])
  })
})

describe('Swipe', () => {
  const drag = (pointerType: string, dx: number, dy: number, click = false) => {
    const card = document.querySelector('.deck .pick') as HTMLElement
    const down = createEvent.pointerDown(card, { pointerType, clientX: 100, clientY: 100 })
    // jsdom has PointerEvent, so the handler sees real coordinates.
    expect(down).toMatchObject({ clientX: 100, pointerType })
    fireEvent(card, down)
    fireEvent.pointerMove(card, { pointerType, clientX: 100 + dx / 2, clientY: 100 + dy / 2 })
    fireEvent.pointerUp(card, { pointerType, clientX: 100 + dx, clientY: 100 + dy })
    if (click) fireEvent.click(within(card).getByRole('button', { name: 'I bought this' }))
  }

  it('a touch drag of 120 px right says Yes, and swallows the click after it', async () => {
    const { api } = await open([three()])
    drag('touch', 120, 10, true)
    await waitFor(() => expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/picks/1', body: { reaction: 'yes' } }]))
  })

  it('only the click right after a drag is swallowed', async () => {
    const { api } = await open([three()])
    drag('touch', 30, 0)
    await wait(1)
    fireEvent.click(screen.getByRole('button', { name: 'I bought this' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { list: 'bought', boughtPickId: 1 } }]),
    )
  })

  it('a mouse drag or a mostly vertical touch drag sends nothing', async () => {
    const { api } = await open([three()])
    drag('mouse', 120, 0)
    drag('touch', 100, 150)
    await wait(50)
    expect(api.writes()).toEqual([])
  })
})

describe('Pick card', () => {
  const show = (over: Partial<Idea> = {}, onBought = vi.fn()) => {
    render(<PickDeck idea={idea(over)} onReact={vi.fn(async () => {})} onBought={onBought} />)
    return onBought
  }

  it('shows the photo, or the placeholder when it is missing or broken', () => {
    show()
    const img = document.querySelector('.photo img') as HTMLImageElement
    expect(img).toHaveAttribute('src', 'https://bikeshop.be/headwind.jpg')
    expect(img).toHaveAttribute('draggable', 'false')
    expect(screen.queryByText('no photo')).not.toBeInTheDocument()
    fireEvent.error(img)
    expect(document.querySelector('.photo img')).toBeNull()
    expect(screen.getByText('no photo')).toBeInTheDocument()
  })

  it('shows the placeholder without an image', () => {
    show({ picks: [pick({ image: null })] })
    expect(screen.getByText('no photo')).toBeInTheDocument()
  })

  it('shows a checked price, shop, rating, why and caveat', () => {
    show()
    expect(screen.getByText('€ 249,99')).toBeInTheDocument()
    expect(screen.getByText('✓ checked')).toBeInTheDocument()
    expect(screen.getByText(/In stock/)).toBeInTheDocument()
    expect(screen.getByText(/4\.6/)).toBeInTheDocument()
    expect(screen.getByText('Fan speed follows your heart rate')).toBeInTheDocument()
    expect(screen.getByText('Check:').parentElement).toHaveTextContent('Check: Pricey for a fan')
    expect(screen.getByRole('link', { name: /Open shop/ })).toHaveAttribute('href', 'https://bikeshop.be/headwind')
  })

  it('marks a price only seen in search as approximate', () => {
    show({
      picks: [
        pick({
          price: 59,
          suppliers: [{ shop: 'X', url: 'https://x.be/a', price: 59, availability: 'unknown', checked: false }],
        }),
      ],
    })
    expect(screen.getByText('€ 59')).toBeInTheDocument()
    expect(screen.getByText('≈ search price')).toBeInTheDocument()
    expect(screen.queryByText('✓ checked')).not.toBeInTheDocument()
    expect(screen.queryByText(/In stock/)).not.toBeInTheDocument()
  })

  it('flags sold out and over budget', () => {
    show({
      budget: 200,
      picks: [
        pick({
          suppliers: [{ shop: 'X', url: 'https://x.be/a', price: 249.99, availability: 'out_of_stock', checked: true }],
        }),
      ],
    })
    expect(screen.getByText(/Sold out/)).toBeInTheDocument()
    expect(screen.getByText('over budget')).toBeInTheDocument()
  })

  it('lists the other shops', () => {
    show()
    const also = screen.getByText(/^Also at/)
    expect(within(also).getByRole('link', { name: 'bol' })).toHaveAttribute('href', 'https://www.bol.com/be/nl/p/headwind/1')
    expect(also).toHaveTextContent('≈ € 259')
  })

  it('offers "I bought this" on a wanted idea', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    const onBought = show()
    await user.click(screen.getByRole('button', { name: 'I bought this' }))
    expect(onBought).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }))
  })
})
