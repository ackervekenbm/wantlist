import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from './App'
import { UNDO_MS } from './hooks/useIdeas'
import { fakeApi, idea, pick, status } from './test/fakeApi'

async function renderApp() {
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('navigation', { name: 'Lists' })
  await waitFor(() => expect(screen.queryByLabelText('loading')).not.toBeInTheDocument())
  return user
}

describe('App', () => {
  it('shows an empty wanted list with a welcome', async () => {
    fakeApi([])
    await renderApp()
    expect(screen.getByText('Nothing on the list.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Wanted\s*0/ })).toHaveAttribute('aria-pressed', 'true')
  })

  it('adds an idea with Enter, including budget and must-haves', async () => {
    const api = fakeApi([])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: '+ budget & must-haves' }))
    await user.type(screen.getByLabelText(/Budget/), '89,99')
    await user.type(screen.getByLabelText(/Must-haves/), 'quiet')
    await user.type(screen.getByLabelText('What do you want?'), 'Running shoes{Enter}')

    await screen.findByRole('article', { name: 'Running shoes' })
    expect(api.writes()).toEqual([
      { method: 'POST', path: '/api/ideas', body: { text: 'Running shoes', budget: 89.99, notes: 'quiet' } },
    ])
    expect(screen.getByText('up to € 89,99')).toBeInTheDocument()
    expect(screen.getByText(/Waiting for the researcher/)).toBeInTheDocument()
    expect(screen.getByLabelText('What do you want?')).toHaveValue('')
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
    await user.click(screen.getByRole('button', { name: '+ budget & must-haves' }))
    await user.type(screen.getByLabelText(/Budget/), 'cheap')
    await user.type(screen.getByLabelText('What do you want?'), 'Shoes')
    expect(screen.getByText(/Budget should be an amount/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add to wantlist' })).toBeDisabled()
  })

  it('shows the preferences and the picks of a researched idea', async () => {
    fakeApi([idea()])
    await renderApp()
    const card = screen.getByRole('article', { name: 'A fan for my indoor bike setup' })
    expect(within(card).getByText('A strong, quiet fan aimed at you on the trainer')).toBeInTheDocument()
    expect(within(card).getByRole('list', { name: 'Preferences' })).toHaveTextContent(/must have: airflow.*must have: noise.*must have: price/)
    expect(within(card).getByRole('heading', { name: 'Wahoo KICKR Headwind' })).toBeInTheDocument()
    expect(within(card).getByRole('link', { name: /Bikeshop/ })).toHaveAttribute('href', 'https://bikeshop.be/headwind')
  })

  it('moves an idea to Bought with the pick you chose', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /I bought this/ }))

    expect(api.writes()).toEqual([
      { method: 'PATCH', path: '/api/ideas/1', body: { list: 'bought', boughtPickId: 1 } },
    ])
    await waitFor(() => expect(screen.queryByRole('article')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: /Bought\s*1/ })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /Bought\s*1/ }))
    const card = screen.getByRole('article')
    expect(within(card).getByText('Wahoo KICKR Headwind', { selector: 'strong' })).toBeInTheDocument()
    expect(card).toHaveTextContent('at Bikeshop for € 249,99')
    expect(within(card).queryByRole('button', { name: /I bought this/ })).not.toBeInTheDocument()
  })

  it('archives an idea and brings it back', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: "don't want it anymore" }))
    await user.click(await screen.findByRole('button', { name: /Archived\s*1/ }))
    await user.click(screen.getByRole('button', { name: 'want it again' }))
    await user.click(screen.getByRole('button', { name: /Wanted\s*1/ }))
    expect(screen.getByRole('article')).toBeInTheDocument()
    expect(api.writes().map((w) => w.body)).toEqual([{ list: 'archived' }, { list: 'wanted' }])
  })

  it('removes an idea only after the undo window, and undo keeps it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi([idea({ id: 1, text: 'first' }), idea({ id: 2, text: 'second' })])
    const user = await renderApp()

    await user.click(within(screen.getByRole('article', { name: 'first' })).getByRole('button', { name: 'remove' }))
    expect(screen.queryByRole('article', { name: 'first' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'undo' }))
    expect(screen.getByRole('article', { name: 'first' })).toBeInTheDocument()
    expect(api.writes()).toEqual([])

    await user.click(within(screen.getByRole('article', { name: 'second' })).getByRole('button', { name: 'remove' }))
    await act(async () => {
      vi.advanceTimersByTime(UNDO_MS + 10)
    })
    await waitFor(() => expect(api.writes()).toEqual([{ method: 'DELETE', path: '/api/ideas/2', body: undefined }]))
    expect(screen.queryByText(/Removed/)).not.toBeInTheDocument()
  })

  it('shows a failed action in the banner and keeps the idea where it was', async () => {
    fakeApi([idea({ text: 'broken' })])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: "don't want it anymore" }))
    expect(await screen.findByRole('alert')).toHaveTextContent('database is locked')
    expect(screen.getByRole('article', { name: 'broken' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'dismiss' }))
    expect(screen.queryByText('database is locked')).not.toBeInTheDocument()
  })

  it('edits an idea and researches it again', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp()
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
          body: { text: 'A fan for my indoor bike setup', budget: 150, notes: null },
        },
        { method: 'POST', path: '/api/ideas/1/rerun', body: undefined },
      ]),
    )
    expect(await screen.findByText(/Waiting for the researcher/)).toBeInTheDocument()
  })

  it('shows the live research step', async () => {
    fakeApi(
      [idea({ status: 'researching' })],
      status({ running: true, current: { ideaId: 1, step: 'checking 4 offers at the shops' } }),
    )
    await renderApp()
    expect(screen.getByText(/checking 4 offers at the shops…/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent('Researching A fan for my indoor bike setup')
  })

  it('explains a scheduled retry and a stopped idea', async () => {
    fakeApi([
      idea({ id: 1, text: 'retry', status: 'queued', error: 'quota', nextAttemptAt: '2026-11-07T15:00:00Z', picks: [] }),
      idea({ id: 2, text: 'stopped', status: 'error', error: 'The searches found nothing to buy.', picks: [] }),
    ])
    await renderApp()
    expect(within(screen.getByRole('article', { name: 'retry' })).getByText(/trying again around/)).toBeInTheDocument()
    expect(within(screen.getByRole('article', { name: 'stopped' })).getByRole('alert')).toHaveTextContent(
      'Research stopped: The searches found nothing to buy.',
    )
  })

  it('says when research is off and which key is missing', async () => {
    fakeApi([], status({ researchEnabled: false, missingKeys: ['SERPER_API_KEY'], models: [] }))
    await renderApp()
    expect(screen.getByText(/Research is switched off: set SERPER_API_KEY/)).toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent('Research off')
  })

  it('says when every model is out of quota', async () => {
    fakeApi(
      [],
      status({ models: [{ id: 'gemini:a', benchedUntil: '2026-11-08T08:00:00.000Z', reason: 'quota' }] }),
    )
    await renderApp()
    expect(screen.getByRole('status', { name: 'Researcher' })).toHaveTextContent(/Out of quota until/)
  })

  it('collapses a card to its top pick and remembers it', async () => {
    fakeApi([idea({ picks: [pick(), pick({ id: 2, rank: 2, title: 'Lasko fan', price: 59 })] })])
    const user = await renderApp()
    await user.click(screen.getByRole('button', { name: /A fan for my indoor bike setup/ }))
    expect(screen.getByText('Top pick: Wahoo KICKR Headwind · € 249,99 · 2 picks')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Lasko fan' })).not.toBeInTheDocument()
    expect(localStorage.getItem('wantlist.collapsed')).toBe('[1]')
  })

  it('filters a long list', async () => {
    fakeApi(Array.from({ length: 9 }, (_, i) => idea({ id: i + 1, text: i === 4 ? 'standing desk' : `idea ${i}` })))
    const user = await renderApp()
    await user.type(screen.getByLabelText('Filter ideas'), 'desk')
    expect(screen.getAllByRole('article')).toHaveLength(1)
  })

  it('stays on an idea after a reload once the ideas load', async () => {
    history.replaceState(null, '', '#/idea/1')
    fakeApi([idea({ id: 1, title: 'Quiet trainer fan' })])
    await renderApp()
    const h1 = screen.getByRole('heading', { level: 1, name: 'Quiet trainer fan' })
    expect(location.hash).toBe('#/idea/1')
    expect(h1).toHaveFocus()
  })

  it('sends an unknown idea back home once loaded, without a new history entry', async () => {
    history.replaceState(null, '', '#/idea/999')
    const entries = history.length
    fakeApi([idea({ id: 1 })])
    await renderApp()
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(history.length).toBe(entries)
    expect(screen.getByText('Pick an idea on the left, or add one')).toBeInTheDocument()
  })
})
