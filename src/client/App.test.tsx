import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { UNDO_MS } from './hooks/useIdeas'
import { fakeApi, idea, status } from './test/fakeApi'

/** Renders the app on a route (`#/idea/1`, `#/lists/wanted`, …) once the ideas have loaded. */
async function renderApp(hash = '#/') {
  history.replaceState(null, '', hash)
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('form', { name: 'Add an idea' })
  await waitFor(() => expect(screen.queryByLabelText('loading')).not.toBeInTheDocument())
  return user
}

describe('App', () => {
  it('shows an empty wanted list with a welcome', async () => {
    fakeApi([])
    await renderApp()
    expect(screen.getByText('Nothing on the list.')).toBeInTheDocument()
  })

  it('adds an idea with Enter, including budget and notes, and opens it from its row', async () => {
    const api = fakeApi([])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: '+ Budget & notes' }))
    await user.type(screen.getByLabelText(/Budget/), '89,99')
    await user.type(screen.getByLabelText(/Notes/), 'quiet')
    await user.type(screen.getByLabelText('What do you want?'), 'Running shoes{Enter}')

    const researcher = await screen.findByRole('region', { name: /^With the researcher/ })
    const row = within(researcher).getByRole('button', { name: /Running shoes.*queued/ })
    expect(api.writes()).toEqual([
      {
        method: 'POST',
        path: '/api/ideas',
        body: { text: 'Running shoes', budget: 89.99, notes: 'quiet' },
      },
    ])
    expect(screen.getByLabelText('What do you want?')).toHaveValue('')

    await user.click(row)
    expect(location.hash).toBe('#/idea/1')
    expect(screen.getByRole('heading', { level: 1, name: 'Running shoes' })).toHaveFocus()
    expect(screen.queryByText(/You wrote/)).not.toBeInTheDocument()
    expect(screen.getByText('quiet · max € 89,99')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Round 1 is queued' })).toBeInTheDocument()
  })

  it('goes back home from an idea and puts focus on its row', async () => {
    fakeApi([idea({ id: 1, title: 'Quiet trainer fan' })])
    const user = await renderApp()
    const row = screen.getByRole('button', {
      name: /Quiet trainer fan.*React/,
    })
    await user.click(row)
    expect(row).toHaveAttribute('aria-current', 'true')
    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(row).toHaveFocus()
  })

  it('steps back with the Home link, so the system Back does not reopen the idea', async () => {
    fakeApi([idea({ id: 1, title: 'Quiet trainer fan' })])
    // What came before the app in this tab.
    history.replaceState(null, '', '#/lists/bought')
    history.pushState(null, '', '#/')
    const user = await renderApp('#/')
    await user.click(screen.getByRole('button', { name: /Quiet trainer fan.*React/ }))
    expect(location.hash).toBe('#/idea/1')
    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    act(() => history.back())
    await waitFor(() => expect(location.hash).toBe('#/lists/bought'))
    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toBeInTheDocument()
  })

  it('focuses the home heading when the idea has no row there, or when coming from the lists', async () => {
    fakeApi([idea({ id: 1, title: 'Old lamp', list: 'archived' })])
    const user = await renderApp('#/idea/1')
    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    const home = screen.getByRole('heading', { level: 1, name: 'wantlist' })
    expect(home).toHaveFocus()

    await user.click(screen.getByRole('button', { name: '1 Archived' }))
    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toHaveFocus()
    await user.click(screen.getByRole('link', { name: 'Home' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(home).toHaveFocus()
  })

  it('keeps focus on the tab when switching list tabs', async () => {
    fakeApi([idea({ id: 1 }), idea({ id: 2, text: 'old lamp', list: 'archived' })])
    const user = await renderApp('#/lists/wanted')
    const tab = screen.getByRole('button', { name: /^Archived\s*1$/ })
    await user.click(tab)
    expect(location.hash).toBe('#/lists/archived')
    expect(tab).toHaveAttribute('aria-pressed', 'true')
    expect(tab).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Remove old lamp' })).toBeInTheDocument()
  })

  it('opens an idea from home, reacts, refines, and the round shows as queued', async () => {
    const api = fakeApi([idea({ id: 1, title: 'Quiet trainer fan' })])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /Quiet trainer fan.*React/ }))
    const pane = within(document.querySelector('.pane-right') as HTMLElement)
    await user.click(pane.getByRole('button', { name: 'Yes' }))
    await user.click(await pane.findByRole('button', { name: 'Refine with 1' }))
    expect(await pane.findByRole('region', { name: 'Round 2 is queued' })).toBeInTheDocument()
    expect(api.writes()).toEqual([
      { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'yes' } },
      { method: 'POST', path: '/api/ideas/1/refine', body: undefined },
    ])
    expect(within(screen.getByRole('region', { name: /^With the researcher/ })).getByRole('button', { name: /Quiet trainer fan/ })).toBeInTheDocument()
  })

  it('switches the theme from the top bar: system, light, dark, and back', async () => {
    fakeApi([])
    const user = await renderApp()
    const html = document.documentElement
    expect(html.dataset.theme).toBeUndefined()
    await user.click(screen.getByRole('button', { name: 'Theme: system. Switch to light' }))
    expect(html.dataset.theme).toBe('light')
    await user.click(screen.getByRole('button', { name: 'Theme: light. Switch to dark' }))
    expect(html.dataset.theme).toBe('dark')
    expect(localStorage.getItem('wantlist.theme')).toBe('dark')
    await user.click(screen.getByRole('button', { name: 'Theme: dark. Switch to system' }))
    expect(html.dataset.theme).toBeUndefined()
    expect(screen.getByRole('button', { name: 'Theme: system. Switch to light' })).toBeInTheDocument()
  })

  it('keeps the text and shows why when adding fails', async () => {
    fakeApi([])
    const user = await renderApp()
    await user.type(screen.getByLabelText('What do you want?'), 'fail{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent('text is longer than 500 characters')
    expect(screen.getByLabelText('What do you want?')).toHaveValue('fail')
  })

  it('Shift+Enter adds a new line instead of submitting', async () => {
    const api = fakeApi([])
    const user = await renderApp()
    await user.type(screen.getByLabelText('What do you want?'), 'line one{Shift>}{Enter}{/Shift}line two')
    expect(screen.getByLabelText('What do you want?')).toHaveValue('line one\nline two')
    expect(api.writes()).toEqual([])
  })

  it('refuses a budget that is not an amount', async () => {
    fakeApi([])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: '+ Budget & notes' }))
    await user.type(screen.getByLabelText(/Budget/), 'cheap')
    await user.type(screen.getByLabelText('What do you want?'), 'Shoes')
    expect(screen.getByText(/Budget should be an amount/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })

  it('shows the preferences and the picks of a researched idea', async () => {
    fakeApi([idea()])
    await renderApp('#/idea/1')
    const card = within(document.querySelector('.pane-right') as HTMLElement)
    expect(card.getByText('A strong, quiet fan aimed at you on the trainer')).toBeInTheDocument()
    expect(card.getByRole('list', { name: 'Preferences' })).toHaveTextContent(
      /must have: airflow.*must have: noise.*must have: price/,
    )
    expect(card.getByRole('heading', { name: 'Wahoo KICKR Headwind' })).toBeInTheDocument()
    expect(card.getByRole('link', { name: /Open shop/ })).toHaveAttribute('href', 'https://bikeshop.be/headwind')
  })

  it('moves an idea to Bought with the pick you chose', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp('#/idea/1')
    await user.click(screen.getByRole('button', { name: /I bought this/ }))

    expect(api.writes()).toEqual([
      {
        method: 'PATCH',
        path: '/api/ideas/1',
        body: { list: 'bought', boughtPickId: 1 },
      },
    ])
    await waitFor(() => expect(screen.queryByRole('button', { name: /I bought this/ })).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: '1 Bought' }))
    expect(location.hash).toBe('#/lists/bought')
    expect(await screen.findByText(/^Wahoo KICKR Headwind · Bikeshop · €\s249,99/)).toBeInTheDocument()
  })

  it('archives an idea and brings it back', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp('#/lists/wanted')
    await user.click(screen.getByRole('button', { name: /^Archive / }))
    await user.click(await screen.findByRole('button', { name: /^Archived\s*1$/ }))
    await user.click(screen.getByRole('button', { name: /^Want .* again$/ }))
    await user.click(screen.getByRole('button', { name: /^Wanted\s*1$/ }))
    expect(screen.getByRole('button', { name: /^Archive / })).toBeInTheDocument()
    expect(api.writes().map((w) => w.body)).toEqual([{ list: 'archived' }, { list: 'wanted' }])
  })

  it('removes an idea only after the undo window, and undo keeps it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi([idea({ id: 1, text: 'first' }), idea({ id: 2, text: 'second' })])
    const user = await renderApp('#/lists/wanted')

    await user.click(screen.getByRole('button', { name: 'Archive first' }))
    await user.click(await screen.findByRole('button', { name: /^Archived\s*1$/ }))
    await user.click(screen.getByRole('button', { name: 'Remove first' }))
    expect(screen.queryByRole('button', { name: 'Remove first' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(screen.getByRole('button', { name: 'Remove first' })).toBeInTheDocument()
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { list: 'archived' } }])

    await user.click(screen.getByRole('button', { name: /^Wanted\s*1$/ }))
    await user.click(screen.getByRole('button', { name: 'Archive second' }))
    await user.click(screen.getByRole('button', { name: /^Archived\s*2$/ }))
    await user.click(screen.getByRole('button', { name: 'Remove second' }))
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 10)
    })
    await waitFor(() =>
      expect(api.writes().at(-1)).toEqual({
        method: 'DELETE',
        path: '/api/ideas/2',
        body: undefined,
      }),
    )
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument()
  })

  it('shows a failed action in the banner and keeps the idea where it was', async () => {
    fakeApi([idea({ text: 'broken' })])
    const user = await renderApp('#/lists/wanted')
    await user.click(screen.getByRole('button', { name: 'Archive broken' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
    expect(screen.getByRole('button', { name: 'Archive broken' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByText('database is locked')).not.toBeInTheDocument()
  })

  it('shows the live research step', async () => {
    fakeApi(
      [idea({ status: 'researching' })],
      status({
        running: true,
        current: { ideaId: 1, step: 'checking 4 offers at the shops' },
      }),
    )
    await renderApp('#/idea/1')
    expect(screen.getByText(/checking 4 offers at the shops…/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent(
      'Researching A fan for my indoor bike setup',
    )
  })

  it('says when research is off and which key is missing', async () => {
    fakeApi(
      [],
      status({
        researchEnabled: false,
        missingKeys: ['SERPER_API_KEY'],
        models: [],
      }),
    )
    await renderApp()
    expect(screen.getByText(/SERPER_API_KEY is missing on the server/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent('Research off')
  })

  it('says when every model is out of quota', async () => {
    fakeApi(
      [],
      status({
        models: [
          {
            id: 'gemini:a',
            benchedUntil: '2026-11-08T08:00:00.000Z',
            reason: 'quota',
          },
        ],
      }),
    )
    await renderApp()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent(/Out of quota until/)
  })

  it('says how many ideas are queued', async () => {
    fakeApi([], status({ queuedCount: 2 }))
    await renderApp()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent(/^2 queued$/)
  })

  it('says the researcher is idle when nothing waits', async () => {
    fakeApi([])
    await renderApp()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent(/^Researcher idle$/)
  })

  it('filters a long list', async () => {
    fakeApi(Array.from({ length: 9 }, (_, i) => idea({ id: i + 1, text: i === 4 ? 'standing desk' : `idea ${i}` })))
    const user = await renderApp('#/lists/wanted')
    await user.type(screen.getByLabelText('Filter ideas'), 'desk')
    expect(screen.getAllByRole('button', { name: /^Archive / })).toHaveLength(1)
  })

  it('drops the filter text when switching tabs', async () => {
    fakeApi([
      ...Array.from({ length: 9 }, (_, i) => idea({ id: i + 1, text: `idea ${i}` })),
      idea({ id: 10, text: 'old lamp', list: 'archived' }),
    ])
    const user = await renderApp('#/lists/wanted')
    await user.type(screen.getByLabelText('Filter ideas'), 'zzz')
    await user.click(screen.getByRole('button', { name: /^Archived\s*1$/ }))
    expect(screen.getByRole('button', { name: 'Remove old lamp' })).toBeInTheDocument()
  })

  it('shows a skeleton, not an empty list, until the ideas load', async () => {
    fakeApi([])
    history.replaceState(null, '', '#/lists/wanted')
    render(<App />)
    const pane = document.querySelector('.pane-right') as HTMLElement
    expect(within(pane).getByLabelText('loading')).toBeInTheDocument()
    expect(await within(pane).findByText('Nothing on the list.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toHaveFocus()
  })

  it('stays on an idea after a reload once the ideas load', async () => {
    fakeApi([idea({ id: 1, title: 'Quiet trainer fan' })])
    await renderApp('#/idea/1')
    const h1 = screen.getByRole('heading', {
      level: 1,
      name: 'Quiet trainer fan',
    })
    expect(location.hash).toBe('#/idea/1')
    expect(h1).toHaveFocus()
  })

  it('stays on a list tab after a reload, with its home tile marked', async () => {
    fakeApi([idea({ id: 1 }), idea({ id: 2, text: 'lamp', list: 'bought', bought: null })])
    await renderApp('#/lists/bought')
    expect(screen.getByRole('heading', { level: 1, name: 'Lists' })).toHaveFocus()
    expect(screen.getByRole('button', { name: /^Bought\s*1$/ })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Bought something else')).toBeInTheDocument()
    const tiles = within(screen.getByRole('navigation', { name: 'Lists' }))
    expect(tiles.getByRole('button', { name: '1 Bought' })).toHaveAttribute('aria-current', 'true')
    expect(tiles.getByRole('button', { name: '1 Wanted' })).not.toHaveAttribute('aria-current')
  })

  it('sends an unknown idea back home once loaded, without a new history entry', async () => {
    history.replaceState(null, '', '#/idea/999')
    const entries = history.length
    fakeApi([idea({ id: 1 })])
    await renderApp('#/idea/999')
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(history.length).toBe(entries)
    expect(screen.getByText('Pick an idea on the left, or add one')).toBeInTheDocument()
  })
})
