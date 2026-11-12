import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../App'
import { BUSY_POLL_MS } from '../hooks/useIdeas'
import { fakeApi, idea, pick, status } from '../test/fakeApi'

/** The old IdeaCards live on the lists route until the idea screen replaces them. */
async function renderApp() {
  history.replaceState(null, '', '#/lists/wanted')
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('form', { name: 'Add an idea' })
  await waitFor(() => expect(screen.queryByLabelText('loading')).not.toBeInTheDocument())
  return user
}

describe('IdeaCard', () => {
  it('shows the model title with the original words underneath, and renames it', async () => {
    const api = fakeApi([idea({ title: 'Quiet trainer fan' })])
    const user = await renderApp()
    const card = screen.getByRole('article', { name: 'Quiet trainer fan' })
    expect(within(card).getByRole('button', { name: 'Quiet trainer fan' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(card).getByText('you asked: A fan for my indoor bike setup')).toBeInTheDocument()

    const rename = within(card).getByRole('button', { name: 'rename' })
    await user.click(rename)
    await user.type(within(card).getByRole('textbox', { name: 'Card title' }), ' nope{Escape}')
    expect(within(card).queryByRole('textbox', { name: 'Card title' })).not.toBeInTheDocument()
    expect(within(card).getByRole('button', { name: 'rename' })).toHaveFocus()
    expect(api.writes()).toEqual([])

    await user.click(within(card).getByRole('button', { name: 'rename' }))
    const input = within(card).getByRole('textbox', { name: 'Card title' })
    expect(input).toHaveValue('Quiet trainer fan')
    await user.clear(input)
    await user.type(input, '  Desk fan {Enter}')
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { title: 'Desk fan' } }])
    expect(await screen.findByRole('article', { name: 'Desk fan' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'rename' })).toHaveFocus()
  })

  it('reacts with why-not and clears a reaction by tapping it again', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp()
    const bar = screen.getByRole('group', { name: 'Your reaction to Wahoo KICKR Headwind' })
    const no = within(bar).getByRole('button', { name: 'No way' })
    expect(no).toHaveAttribute('aria-pressed', 'false')

    await user.click(no)
    expect(no).toHaveAttribute('aria-pressed', 'true')
    const why = screen.getByRole('textbox', { name: 'Why not Wahoo KICKR Headwind?' })
    expect(why).toHaveFocus()
    await user.type(why, 'too fluffy{Enter}')
    await user.tab()
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/1', body: { reaction: 'no' } },
        { method: 'PATCH', path: '/api/picks/1', body: { reason: 'too fluffy' } },
      ]),
    )

    await user.click(within(bar).getByRole('button', { name: 'No way' }))
    await waitFor(() => expect(api.writes()).toHaveLength(3))
    expect(api.writes()[2]).toEqual({ method: 'PATCH', path: '/api/picks/1', body: { reaction: null, reason: null } })
    expect(screen.queryByRole('textbox', { name: /Why not/ })).not.toBeInTheDocument()
  })

  it('enables refine once there is a reaction, sends it once', async () => {
    const api = fakeApi([idea()])
    const user = await renderApp()
    const refine = screen.getByRole('button', { name: 'Refine' })
    expect(refine).toBeDisabled()
    expect(screen.getByText('react to a pick first')).toBeVisible()
    expect(refine).toHaveAccessibleDescription('react to a pick first')

    await user.click(screen.getByRole('button', { name: 'Yes' }))
    const ready = await screen.findByRole('button', { name: 'Refine with 1 reaction' })
    expect(ready).toBeEnabled()
    await user.dblClick(ready)
    await waitFor(() => expect(screen.getByText(/Waiting for the researcher/)).toBeInTheDocument())
    expect(api.writes().filter((w) => w.path === '/api/ideas/1/refine')).toEqual([
      { method: 'POST', path: '/api/ideas/1/refine', body: undefined },
    ])
  })

  it('pins keepers and folds earlier rounds', async () => {
    fakeApi([
      idea({
        round: 2,
        picks: [
          pick({ id: 20, round: 2, rank: 1, title: 'Vornado 630' }),
          pick({ id: 11, round: 1, rank: 1, title: 'Felt mule', price: 45, reaction: 'yes' }),
          pick({ id: 12, round: 1, rank: 2, title: 'Lasko', reaction: 'no', reason: 'too loud' }),
          pick({ id: 13, round: 1, rank: 3, title: 'Honeywell', reaction: 'maybe' }),
        ],
      }),
    ])
    const user = await renderApp()
    const keepers = screen.getByRole('list', { name: 'Keepers' })
    expect(keepers).toHaveTextContent(/Felt mule · round 1 · € 45/)
    expect(within(keepers).getByRole('button', { name: /I bought this/ })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: 'Round 2 picks' })).toHaveTextContent('Vornado 630')
    // Only round-1 reactions: refine is offered, without a count.
    expect(screen.getByRole('button', { name: 'Refine' })).toBeEnabled()

    const round = screen.getByRole('button', { name: 'Round 1 · 3 picks · 1 no · 1 kind of · 1 yes' })
    expect(round).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('heading', { name: 'Lasko' })).not.toBeInTheDocument()

    await user.click(round)
    expect(round).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('heading', { name: 'Lasko' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Your reaction to Lasko' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Why not Lasko?' })).toHaveValue('too loud')
    expect(screen.getByRole('textbox', { name: 'Why not Lasko?' })).not.toHaveFocus()
  })

  it('edits preferences, keeps the draft through a poll, and not while a round is running', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const api = fakeApi([idea()], status({ running: true }))
    const user = await renderApp()
    const poll = () =>
      act(async () => {
        vi.advanceTimersByTime(BUSY_POLL_MS + 10)
      })

    await user.click(screen.getByRole('button', { name: 'edit preferences' }))
    const must = screen.getByLabelText('Must have, one per line')
    expect(must).toHaveValue('airflow\nnoise\nprice')
    await user.type(must, '\n\n  quiet  ')
    await user.type(screen.getByLabelText('Avoid, one per line'), 'subscriptions')

    api.ideas()[0].preferences = { ...api.ideas()[0].preferences!, mustHaves: ['other'] }
    await poll()
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/api/ideas').length).toBeGreaterThan(1))
    expect(screen.getByLabelText('Must have, one per line')).toHaveValue('airflow\nnoise\nprice\n\n  quiet  ')

    await user.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        {
          method: 'PATCH',
          path: '/api/ideas/1',
          body: {
            preferences: {
              summary: 'A strong, quiet fan aimed at you on the trainer',
              mustHaves: ['airflow', 'noise', 'price', 'quiet'],
              avoid: ['subscriptions'],
              likes: [],
            },
          },
        },
      ]),
    )
    expect(await screen.findByRole('button', { name: 'Refine with your edits' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'edit preferences' }))
    api.ideas()[0].status = 'researching'
    await poll()
    expect(await screen.findByText('round in progress')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
