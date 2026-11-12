import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { UNDO_MS } from './hooks/useIdeas'
import { fakeApi, idea, pick, status } from './test/fakeApi'

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

    const row = await screen.findByRole('button', {
      name: /Running shoes.*queued/,
    })
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
    expect(screen.getByText('up to € 89,99')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for the researcher/)).toBeInTheDocument()
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
    const card = screen.getByRole('article', {
      name: 'A fan for my indoor bike setup',
    })
    expect(within(card).getByText('A strong, quiet fan aimed at you on the trainer')).toBeInTheDocument()
    expect(within(card).getByRole('list', { name: 'Preferences' })).toHaveTextContent(
      /must have: airflow.*must have: noise.*must have: price/,
    )
    expect(within(card).getByRole('heading', { name: 'Wahoo KICKR Headwind' })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Bikeshop/ })).toHaveAttribute('href', 'https://bikeshop.be/headwind')
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
    await user.click(screen.getByRole('button', { name: 'undo' }))
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
    await user.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.queryByText('database is locked')).not.toBeInTheDocument()
  })

  it('edits an idea and researches it again', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp('#/idea/1')
    await user.click(screen.getByRole('button', { name: 'edit' }))
    const budget = screen.getByLabelText(/Budget/)
    await user.clear(budget)
    await user.type(budget, '150')
    await user.click(screen.getByRole('button', { name: 'Save & research again' }))

    await waitFor(() =>
      expect(api.writes()).toEqual([
        {
          method: 'PATCH',
          path: '/api/ideas/1',
          body: {
            text: 'A fan for my indoor bike setup',
            budget: 150,
            notes: null,
          },
        },
        { method: 'POST', path: '/api/ideas/1/rerun', body: undefined },
      ]),
    )
    expect(await screen.findByText(/Waiting for the researcher/)).toBeInTheDocument()
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

  it('explains a scheduled retry and a stopped idea', async () => {
    fakeApi([
      idea({
        id: 1,
        text: 'retry',
        status: 'queued',
        error: 'quota',
        nextAttemptAt: '2026-11-07T15:00:00Z',
        picks: [],
      }),
      idea({
        id: 2,
        text: 'stopped',
        status: 'error',
        error: 'The searches found nothing to buy.',
        picks: [],
      }),
    ])
    await renderApp('#/idea/1')
    expect(within(screen.getByRole('article', { name: 'retry' })).getByText(/trying again around/)).toBeInTheDocument()
    location.hash = '#/idea/2'
    expect(await screen.findByRole('article', { name: 'stopped' })).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'stopped' })).getByRole('alert')).toHaveTextContent(
      'Research stopped: The searches found nothing to buy.',
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

  it('collapses a card to its top pick and remembers it', async () => {
    fakeApi([
      idea({
        picks: [pick(), pick({ id: 2, rank: 2, title: 'Lasko fan', price: 59 })],
      }),
    ])
    const user = await renderApp('#/idea/1')
    await user.click(
      within(screen.getByRole('article')).getByRole('button', {
        name: /A fan for my indoor bike setup/,
      }),
    )
    expect(screen.getByText('Top pick: Wahoo KICKR Headwind · € 249,99 · 2 picks')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Lasko fan' })).not.toBeInTheDocument()
    expect(localStorage.getItem('wantlist.collapsed')).toBe('[1]')
  })

  it('filters a long list', async () => {
    fakeApi(Array.from({ length: 9 }, (_, i) => idea({ id: i + 1, text: i === 4 ? 'standing desk' : `idea ${i}` })))
    const user = await renderApp('#/lists/wanted')
    await user.type(screen.getByLabelText('Filter ideas'), 'desk')
    expect(screen.getAllByRole('button', { name: /^Archive / })).toHaveLength(1)
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
