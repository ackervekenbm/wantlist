import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Idea, ServerStatus } from '../../types'
import { App } from '../App'
import { BUSY_POLL_MS } from '../hooks/useIdeas'
import { fakeApi, idea, pick, status } from '../test/fakeApi'

/** The app on idea 1 (or `id`), once the ideas have loaded. */
async function open(ideas: Idea[], serverStatus?: ServerStatus, id = 1) {
  const api = fakeApi(ideas, serverStatus)
  history.replaceState(null, '', `#/idea/${id}`)
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('form', { name: 'Add an idea' })
  await waitFor(() => expect(screen.queryByLabelText('loading')).not.toBeInTheDocument())
  return { api, user }
}

const pane = () => within(document.querySelector('.pane-right') as HTMLElement)
const menu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: 'Idea actions' }))
  return within(await screen.findByRole('dialog', { name: /./ }))
}

describe('IdeaScreen header', () => {
  it('shows the kicker, the title in the h1 and what you wrote', async () => {
    await open([idea({ title: 'Quiet trainer fan', round: 2, notes: 'white', budget: 200 })])
    expect(pane().getByText('Explore · round 2')).toBeInTheDocument()
    expect(pane().getByRole('heading', { level: 1, name: 'Quiet trainer fan' })).toHaveFocus()
    expect(pane().getByText(/^You wrote/)).toHaveTextContent('You wrote A fan for my indoor bike setup · white · max € 200')
  })
})

describe('StatusCard', () => {
  it('shows the live step while researching, without Try now', async () => {
    await open([idea({ status: 'researching' })], status({ running: true, current: { ideaId: 1, step: 'reading 11 shop pages' } }))
    const card = pane().getByRole('region', { name: 'Researching round 2' })
    expect(card).toHaveTextContent('reading 11 shop pages…')
    expect(card).toHaveTextContent('Usually a few minutes; you can leave')
    expect(within(card).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says a round is queued', async () => {
    await open([idea({ status: 'queued', round: 0, picks: [], preferences: null })])
    expect(pane().getByRole('region', { name: 'Round 1 is queued' })).toBeInTheDocument()
  })

  it('offers Try now on a retry, which re-runs', async () => {
    const { api, user } = await open([
      idea({ status: 'queued', error: 'The model was busy', attempts: 2, nextAttemptAt: '2026-11-12T11:30:00Z' }),
    ])
    const card = pane().getByRole('region', { name: /^Retrying around/ })
    expect(card).toHaveTextContent('The model was busy')
    // attempts counts failures: two failed, the retry is the third.
    expect(card).toHaveTextContent('Attempt 3 of 5 next.')
    await user.click(within(card).getByRole('button', { name: 'Try now' }))
    expect(api.writes()).toEqual([{ method: 'POST', path: '/api/ideas/1/rerun', body: undefined }])
  })

  it('shows why research stopped, with Try again', async () => {
    const { api, user } = await open([idea({ status: 'error', errorKind: 'stopped', error: 'Serper refused the key' })])
    const card = pane().getByRole('region', { name: 'Stopped' })
    expect(card).toHaveTextContent('Serper refused the key')
    await user.click(within(card).getByRole('button', { name: 'Try again' }))
    expect(api.writes()).toEqual([{ method: 'POST', path: '/api/ideas/1/rerun', body: undefined }])
  })

  it('says research is off, and out of quota, for a queued idea', async () => {
    await open([idea({ status: 'queued' })], status({ researchEnabled: false, missingKeys: ['SERPER_API_KEY'], models: [] }))
    expect(pane().getByRole('region', { name: 'Research is off' })).toBeInTheDocument()
  })

  it('says when every model is out of quota', async () => {
    await open(
      [idea({ status: 'queued' })],
      status({ models: [{ id: 'gemini:a', benchedUntil: '2026-11-12T08:00:00.000Z', reason: 'quota' }] }),
    )
    expect(pane().getByRole('region', { name: /^Out of quota until/ })).toBeInTheDocument()
  })

  it('shows no card on a done idea', async () => {
    await open([idea()])
    expect(pane().queryByRole('region', { name: /queued|Researching|Stopped|Nothing new/ })).not.toBeInTheDocument()
  })
})

describe('Nothing new: Loosen and Reword', () => {
  const nothingNew = (over: Partial<Idea> = {}) =>
    idea({ status: 'error', errorKind: 'nothing-new', error: 'Nothing new found.', ...over })

  it('Loosen opens the preferences editor, again after a cancel, and saves nothing by itself', async () => {
    const { api, user } = await open([nothingNew()])
    const card = pane().getByRole('region', { name: 'Nothing new found' })
    await user.click(within(card).getByRole('button', { name: 'Loosen a criterion' }))
    expect(screen.getByLabelText('Must have, one per line')).toHaveValue('airflow\nnoise\nprice')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByLabelText('Must have, one per line')).not.toBeInTheDocument()
    await user.click(within(card).getByRole('button', { name: 'Loosen a criterion' }))
    expect(screen.getByLabelText('Must have, one per line')).toBeInTheDocument()
    expect(api.writes()).toEqual([])
  })

  it('Reword opens the edit sheet and saves nothing by itself', async () => {
    const { api, user } = await open([nothingNew()])
    await user.click(pane().getByRole('button', { name: 'Reword' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Edit idea' }))
    expect(sheet.getByLabelText('What do you want?')).toHaveValue('A fan for my indoor bike setup')
    await user.click(sheet.getByRole('button', { name: 'cancel' }))
    expect(screen.queryByLabelText('What do you want?', { selector: '.sheet textarea' })).not.toBeInTheDocument()
    expect(api.writes()).toEqual([])
  })

  it('has no Loosen without preferences', async () => {
    await open([nothingNew({ preferences: null })])
    expect(pane().queryByRole('button', { name: 'Loosen a criterion' })).not.toBeInTheDocument()
    expect(pane().getByRole('button', { name: 'Reword' })).toBeInTheDocument()
  })
})

describe('Idea menu', () => {
  it('researches again and records buying something else', async () => {
    const { api, user } = await open([idea()])
    let m = await menu(user)
    expect(m.getAllByRole('button').map((b) => b.textContent)).toEqual([
      'Edit idea',
      'Research again',
      'Bought something else',
      'Archive',
      'Remove',
      'Cancel',
    ])
    await user.click(m.getByRole('button', { name: 'Research again' }))
    m = await menu(user)
    await user.click(m.getByRole('button', { name: 'Bought something else' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'POST', path: '/api/ideas/1/rerun', body: undefined },
        { method: 'PATCH', path: '/api/ideas/1', body: { list: 'bought', boughtPickId: null } },
      ]),
    )
  })

  it('Cancel closes the menu and focus returns to its button', async () => {
    const { api, user } = await open([idea()])
    await user.click((await menu(user)).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('button', { name: 'Archive' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Idea actions' })).toHaveFocus()
    expect(api.writes()).toEqual([])
  })

  it('archives and goes home', async () => {
    const { api, user } = await open([idea()])
    await user.click((await menu(user)).getByRole('button', { name: 'Archive' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { list: 'archived' } }])
  })

  it('removes with undo and goes home', async () => {
    const { api, user } = await open([idea()])
    await user.click((await menu(user)).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(location.hash).toBe('#/'))
    expect(screen.getByRole('button', { name: 'undo' })).toBeInTheDocument()
    expect(api.writes()).toEqual([])
  })

  it('edits the idea and researches it again from the sheet', async () => {
    const { api, user } = await open([idea()])
    await user.click((await menu(user)).getByRole('button', { name: 'Edit idea' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Edit idea' }))
    const budget = sheet.getByLabelText(/Budget/)
    await user.clear(budget)
    await user.type(budget, '150')
    await user.click(sheet.getByRole('button', { name: 'Save & research again' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/ideas/1', body: { text: 'A fan for my indoor bike setup', budget: 150, notes: null } },
        { method: 'POST', path: '/api/ideas/1/rerun', body: undefined },
      ]),
    )
    expect(await pane().findByRole('region', { name: 'Round 2 is queued' })).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Edit idea' })).not.toBeInTheDocument()
  })

  it('hides Research again while researching', async () => {
    const { user } = await open([idea({ status: 'researching' })], status({ running: true }))
    const m = await menu(user)
    expect(m.getByRole('button', { name: 'Edit idea' })).toBeInTheDocument()
    expect(m.queryByRole('button', { name: 'Research again' })).not.toBeInTheDocument()
  })
})

describe('Bought and archived ideas', () => {
  const bought = { title: 'Wahoo KICKR Headwind', shop: 'Bikeshop', url: 'https://x.be', price: 249.99, at: '2026-11-07T10:00:00Z' }

  it('shows what was bought, no reactions, and only Want again and Remove', async () => {
    const { api, user } = await open([idea({ list: 'bought', bought })])
    expect(pane().getByRole('region', { name: 'Bought' })).toHaveTextContent(/Wahoo KICKR Headwind · Bikeshop · €\s249,99/)
    expect(pane().queryByRole('button', { name: 'No way' })).not.toBeInTheDocument()
    expect(pane().queryByRole('button', { name: /^Refine/ })).not.toBeInTheDocument()
    const m = await menu(user)
    expect(m.getAllByRole('button').map((b) => b.textContent)).toEqual(['Want again', 'Remove', 'Cancel'])
    await user.click(m.getByRole('button', { name: 'Want again' }))
    await waitFor(() => expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { list: 'wanted' } }]))
  })

  it('archived: no reactions, only Want again and Remove', async () => {
    const { user } = await open([idea({ list: 'archived' })])
    expect(pane().queryByRole('button', { name: 'No way' })).not.toBeInTheDocument()
    const m = await menu(user)
    expect(m.getAllByRole('button').map((b) => b.textContent)).toEqual(['Want again', 'Remove', 'Cancel'])
  })
})

describe('Ported from IdeaCard', () => {
  it('renames, Escape cancels, and clearing hands the title back', async () => {
    const { api, user } = await open([idea({ title: 'Quiet trainer fan' })])
    await user.click(pane().getByRole('button', { name: 'rename' }))
    await user.type(pane().getByRole('textbox', { name: 'Title' }), ' nope{Escape}')
    expect(pane().queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
    expect(pane().getByRole('button', { name: 'rename' })).toHaveFocus()
    expect(api.writes()).toEqual([])

    await user.click(pane().getByRole('button', { name: 'rename' }))
    const input = pane().getByRole('textbox', { name: 'Title' })
    expect(input).toHaveValue('Quiet trainer fan')
    await user.clear(input)
    await user.type(input, '  Desk fan {Enter}')
    expect(api.writes()).toEqual([{ method: 'PATCH', path: '/api/ideas/1', body: { title: 'Desk fan' } }])
    expect(await pane().findByRole('heading', { level: 1, name: 'Desk fan' })).toBeInTheDocument()
    expect(pane().getByRole('button', { name: 'rename' })).toHaveFocus()

    await user.click(pane().getByRole('button', { name: 'rename' }))
    await user.clear(pane().getByRole('textbox', { name: 'Title' }))
    await user.keyboard('{Enter}')
    await waitFor(() => expect(api.writes().at(-1)).toEqual({ method: 'PATCH', path: '/api/ideas/1', body: { title: null } }))
  })

  it('keeps the preferences draft through a poll, and locks it while researching', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const { api, user } = await open([idea()], status({ running: true }))
    const poll = () =>
      act(async () => {
        vi.advanceTimersByTime(BUSY_POLL_MS + 10)
      })
    expect(pane().getByRole('list', { name: 'Preferences' })).toHaveTextContent(/must have: airflow/)

    await user.click(screen.getByRole('button', { name: 'Edit preferences' }))
    await user.type(screen.getByLabelText('Must have, one per line'), '\nquiet')
    api.ideas()[0].preferences = { ...api.ideas()[0].preferences!, mustHaves: ['other'] }
    await poll()
    await waitFor(() => expect(api.calls.filter((c) => c.path === '/api/ideas').length).toBeGreaterThan(1))
    expect(screen.getByLabelText('Must have, one per line')).toHaveValue('airflow\nnoise\nprice\nquiet')

    api.ideas()[0].status = 'researching'
    await poll()
    expect(await screen.findByText('Locked while the next round researches.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(api.writes()).toEqual([])
  })
})

describe('Refine dock, keepers and earlier rounds', () => {
  it('is disabled with its reason as text until there is a reaction, then refines once', async () => {
    const { api, user } = await open([idea()])
    const refine = pane().getByRole('button', { name: 'Refine' })
    expect(refine).toBeDisabled()
    expect(pane().getByText('React to a pick to refine.')).toBeVisible()
    expect(refine).toHaveAccessibleDescription('React to a pick to refine.')

    await user.click(pane().getByRole('button', { name: 'Yes' }))
    const ready = await pane().findByRole('button', { name: 'Refine with 1' })
    expect(ready).toBeEnabled()
    expect(pane().getByText('1 reaction will steer round 2.')).toBeInTheDocument()
    await user.dblClick(ready)
    expect(await pane().findByRole('region', { name: 'Round 2 is queued' })).toBeInTheDocument()
    expect(api.writes().filter((w) => w.path === '/api/ideas/1/refine')).toEqual([
      { method: 'POST', path: '/api/ideas/1/refine', body: undefined },
    ])
  })

  it('offers Refine with your edits after a preferences edit, with no reactions', async () => {
    await open([idea({ preferencesEdited: true })])
    expect(pane().getByRole('button', { name: 'Refine with your edits' })).toBeEnabled()
    expect(pane().getByText('Your edits will steer round 2.')).toBeInTheDocument()
  })

  it('lists keepers and earlier rounds as rows you can still react to', async () => {
    const { api, user } = await open([
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
    const keepers = within(pane().getByRole('list', { name: 'Keepers' }))
    expect(keepers.getByText('Felt mule')).toBeInTheDocument()
    expect(keepers.getByText(/€\s45/)).toBeInTheDocument()
    expect(keepers.getByRole('button', { name: 'I bought this' })).toBeInTheDocument()
    // Only round-1 reactions: refine is offered, without a count.
    expect(pane().getByRole('button', { name: 'Refine' })).toBeEnabled()

    const round = pane().getByRole('button', { name: /^Round 1/ })
    expect(round).toHaveAttribute('aria-expanded', 'false')
    expect(pane().queryByText('Lasko')).not.toBeInTheDocument()
    await user.click(round)
    expect(round).toHaveAttribute('aria-expanded', 'true')
    const rows = within(pane().getByRole('list', { name: 'Round 1 picks' }))
    expect(rows.getByRole('textbox', { name: 'Why not Lasko?' })).toHaveValue('too loud')
    expect(rows.getByRole('textbox', { name: 'Why not Lasko?' })).not.toHaveFocus()
    expect(rows.getAllByRole('button', { name: 'I bought this' })).toHaveLength(3)

    await user.click(within(rows.getByRole('group', { name: 'Your reaction to Honeywell' })).getByRole('button', { name: 'Yes' }))
    await user.click(within(keepers.getByRole('group', { name: 'Your reaction to Felt mule' })).getByRole('button', { name: 'Yes' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/picks/13', body: { reaction: 'yes' } },
        { method: 'PATCH', path: '/api/picks/11', body: { reaction: null, reason: null } },
      ]),
    )
  })
})
