import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import type { HuntTarget, Idea, OfferFacts, Pick, Purchase, ServerStatus } from '../../types'
import { App } from '../App'
import { fakeApi, idea, pick, status } from '../test/fakeApi'

async function open(ideas: Idea[], serverStatus?: ServerStatus) {
  const api = fakeApi(ideas, serverStatus)
  history.replaceState(null, '', '#/idea/1')
  const user = userEvent.setup()
  render(<App />)
  await screen.findByRole('form', { name: 'Add an idea' })
  await waitFor(() => expect(screen.queryByLabelText('loading')).not.toBeInTheDocument())
  return { api, user }
}

const pane = () => within(document.querySelector('.pane-right') as HTMLElement)

const target: HuntTarget = {
  product: 'Feliway Friends refill',
  variant: '48 ml vial',
  condition: 'new',
  exclude: ['Optimum', 'Classic'],
  unit: 'vial',
}

/** One shop's offer from hunt round 2; checked and in stock unless overridden. */
function offer(id: number, shop: string, price: number, facts: Partial<OfferFacts>, checked = true): Pick {
  const url = `https://${shop.toLowerCase()}.be/feliway`
  return pick({
    id,
    round: 2,
    rank: id,
    kind: 'offer',
    title: `Feliway Friends navulling at ${shop}`,
    shop,
    url,
    price,
    suppliers: [{ shop, url, price, availability: checked ? 'in_stock' : 'unknown', checked }],
    offer: {
      match: 'exact',
      mismatch: null,
      packs: 1,
      unitsPerPack: 1,
      delivery: { kind: 'free', cost: null, threshold: null },
      delivered: price,
      perUnit: price,
      condition: 'new',
      sellerNote: null,
      group: 'exact',
      ...facts,
    },
  })
}

const lastTime: Purchase = {
  id: 9,
  ideaId: 1,
  at: '2026-09-14T10:00:00.000Z',
  shop: 'Zooplus',
  url: 'https://zooplus.be/feliway',
  title: 'Feliway Friends navulling',
  packs: 3,
  unitsPerPack: 1,
  unitLabel: 'vial',
  paid: 65.85,
  perUnit: 21.95,
}

const offers = [
  offer(11, 'Zooplus', 59.95, { packs: 3, delivered: 59.95, perUnit: 19.98, group: 'best' }),
  offer(12, 'Bol', 124.9, { packs: 6, delivered: 124.9, perUnit: 20.82 }),
  offer(13, '24PHARMA', 28.5, { delivery: { kind: 'unknown', cost: null, threshold: null }, delivered: null, perUnit: null }, false),
  offer(14, 'Dierenwinkel', 55, { packs: 3, delivery: { kind: 'pickup_only', cost: null, threshold: null }, delivered: null, group: 'unavailable' }),
  offer(15, 'Medpets', 49.95, { packs: 3, match: 'mismatch', mismatch: 'Optimum', group: 'mismatch' }),
  offer(16, 'Petshop', 39.95, { packs: 2, match: 'mismatch', mismatch: 'Classic', group: 'mismatch' }),
]

function feliway(over: Partial<Idea> = {}): Idea {
  return idea({
    mode: 'hunt',
    text: 'Feliway friends navulling',
    title: 'Feliway Friends refill',
    round: 2,
    target,
    refill: true,
    purchases: [lastTime],
    preferences: null,
    picks: offers,
    ...over,
  })
}

describe('Hunt: the target plate', () => {
  it('shows the product, variant and exclusions, and editing the variant patches the target', async () => {
    const { api, user } = await open([feliway()])
    expect(pane().getByText('HUNT · REFILL')).toBeInTheDocument()
    expect(pane().getByText('Feliway Friends refill · 48 ml vial')).toBeInTheDocument()
    expect(pane().getByText(/Not Optimum, not Classic/)).toBeInTheDocument()

    await user.click(pane().getByRole('button', { name: /Edit target/ }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Edit target' }))
    const variant = sheet.getByRole('textbox', { name: 'Variant' })
    await user.clear(variant)
    await user.type(variant, '3 × 48 ml vial')
    await user.click(sheet.getByRole('button', { name: 'Save' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'PATCH', path: '/api/ideas/1', body: { target: { ...target, variant: '3 × 48 ml vial' } } },
      ]),
    )
  })
})

describe('Hunt: the best offer slip', () => {
  it('shows the shop, pack, delivery, the per-unit price and how it compares with last time', async () => {
    await open([feliway()])
    const slip = pane().getByRole('group', { name: 'Best real offer' })
    expect(slip).toHaveTextContent('Best real offer')
    expect(slip).toHaveTextContent('✓ checked')
    expect(slip).toHaveTextContent('Zooplus')
    expect(slip).toHaveTextContent('In stock')
    expect(slip).toHaveTextContent('3 × 48 ml')
    expect(slip).toHaveTextContent('free')
    expect(slip).toHaveTextContent('€19,98')
    expect(slip).toHaveTextContent('/vial')
    expect(slip).toHaveTextContent('you pay €59,95')
    expect(slip).toHaveTextContent('9% less than last time')
    expect(within(slip).getByRole('link', { name: /Open shop/ })).toHaveAttribute('href', 'https://zooplus.be/feliway')
  })

  it('says once that delivery is not shown, and that the total leaves it out', async () => {
    const unknown = { delivery: { kind: 'unknown' as const, cost: null, threshold: null }, delivered: null, group: 'best' as const }
    await open([feliway({ target: { ...target, unit: null }, picks: [offer(11, 'Delta Bikes', 41.75, unknown)] })])
    const slip = pane().getByRole('group', { name: 'Best real offer' })
    expect(slip.textContent?.match(/delivery not shown/g)).toHaveLength(1)
    expect(slip).toHaveTextContent(/You pay\s*without delivery\s*€41,75/)
  })

  it('notes a cheaper search price under the slip, never on it', async () => {
    await open([
      feliway({
        target: { ...target, unit: null },
        purchases: [],
        picks: [
          offer(11, 'Zooplus', 20, { group: 'best' }),
          offer(12, 'Petsonic', 18.5, {}, false),
        ],
      }),
    ])
    const slip = pane().getByRole('group', { name: 'Best real offer' })
    expect(slip).toHaveTextContent('Zooplus')
    expect(slip).toHaveTextContent('€20,00')
    expect(slip).toHaveTextContent('First time buying this.')
    expect(pane().getAllByText('≈ €18,50 at Petsonic, price not confirmed at the shop')).toHaveLength(1)
  })
})

describe('Hunt: other shops', () => {
  it('lists exact offers with unknown delivery said, and folds the other groups closed with counts', async () => {
    await open([feliway()])
    const others = pane().getByRole('region', { name: /^Other shops/ })
    expect(others).toHaveTextContent('per vial, delivery in')
    const list = within(within(others).getByRole('list', { name: 'Other shops' }))
    expect(list.getAllByRole('listitem')).toHaveLength(2)
    expect(list.getByText('Bol')).toBeInTheDocument()
    expect(list.getByText('€20,82/vial')).toBeInTheDocument()
    expect(list.getByText(/delivery not shown/)).toBeInTheDocument()

    const groups = others.querySelectorAll('details')
    expect(groups).toHaveLength(2)
    for (const g of groups) expect(g).not.toHaveAttribute('open')
    expect(groups[0].querySelector('summary')).toHaveTextContent('Pick-up only or no delivery to Belgium 1')
    expect(groups[1].querySelector('summary')).toHaveTextContent('Not the exact product 2')
  })
})

describe('Hunt: buying', () => {
  it('Bought here opens the sheet pre-filled from the offer and the refill guess, and Save posts the purchase', async () => {
    const { api, user } = await open([feliway()])
    const slip = pane().getByRole('group', { name: 'Best real offer' })
    await user.click(within(slip).getByRole('button', { name: 'Bought here' }))
    const sheet = within(await screen.findByRole('dialog', { name: 'Bought at Zooplus' }))
    expect(sheet.getByRole('textbox', { name: /You paid/ })).toHaveValue('59,95')
    expect(sheet.getByRole('button', { name: /Yes, it's a refill/ })).toHaveAttribute('aria-pressed', 'true')
    expect(sheet.getByRole('button', { name: /No, one-off/ })).toHaveAttribute('aria-pressed', 'false')
    await user.click(sheet.getByRole('button', { name: 'Save purchase' }))
    await waitFor(() =>
      expect(api.writes()).toEqual([
        { method: 'POST', path: '/api/ideas/1/purchases', body: { pickId: 11, paid: 59.95, refill: true } },
      ]),
    )
    expect(await pane().findByText('Covered')).toBeInTheDocument()
  })

  it('a covered hunt shows what you bought, Running low and You paid; Running low queues a hunt', async () => {
    const bought: Purchase = { ...lastTime, id: 10, at: '2026-11-12T08:14:00.000Z', paid: 59.95, perUnit: 19.98 }
    const { api, user } = await open([feliway({ list: 'bought', purchases: [bought, lastTime] })])
    expect(pane().getByText('Covered')).toBeInTheDocument()
    expect(pane().getByText('since 12 Nov')).toBeInTheDocument()
    expect(pane().queryByRole('group', { name: 'Best real offer' })).not.toBeInTheDocument()
    const paid = within(pane().getByRole('region', { name: 'You paid' }))
    expect(paid.getAllByRole('listitem')).toHaveLength(2)
    expect(paid.getByText('12 Nov · Zooplus · 3 × 48 ml vial')).toBeInTheDocument()
    expect(paid.getByText('€21,95/vial')).toBeInTheDocument()

    await user.click(pane().getByRole('button', { name: 'Running low' }))
    expect(api.writes()).toEqual([{ method: 'POST', path: '/api/ideas/1/running-low', body: undefined }])
    expect(await pane().findByRole('region', { name: 'Hunt is queued' })).toBeInTheDocument()
  })
})

describe('Hunt: the mode switch', () => {
  it('switches to Explore to show the deck, with the offers under Earlier hunts, and Hunt this one starts a hunt from a pick', async () => {
    const explorePick = pick({ id: 1, round: 1, title: 'Feliway Friends starter kit' })
    const { api, user } = await open([feliway({ picks: [...offers, explorePick] })])
    // In Hunt, the Explore round folds away.
    expect(pane().getByRole('button', { name: /^Round 1/ })).toHaveAttribute('aria-expanded', 'false')

    await user.click(within(pane().getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Explore' }))
    expect(await pane().findByRole('article', { name: 'Pick 1 of 1' })).toBeInTheDocument()
    expect(pane().getByRole('region', { name: 'Earlier hunts' })).toBeInTheDocument()
    expect(pane().queryByRole('group', { name: 'Best real offer' })).not.toBeInTheDocument()

    await user.click(pane().getByRole('button', { name: 'Hunt this one' }))
    expect(api.writes()).toEqual([
      { method: 'PATCH', path: '/api/ideas/1', body: { mode: 'explore' } },
      { method: 'POST', path: '/api/ideas/1/hunt', body: { pickId: 1 } },
    ])
    expect(await pane().findByRole('group', { name: 'Best real offer' })).toBeInTheDocument()
  })

  it('shows the hunt step while hunting', async () => {
    await open(
      [feliway({ status: 'researching' })],
      status({ running: true, current: { ideaId: 1, step: 'looking for every shop that sells it' } }),
    )
    const card = pane().getByRole('region', { name: 'Hunting' })
    expect(card).toHaveTextContent('looking for every shop that sells it…')
    expect(within(pane().getByRole('group', { name: 'Mode' })).getByRole('button', { name: 'Explore' })).toBeDisabled()
  })
})

describe('Hunt: partner deals', () => {
  it('shows the price after the partner discount and links through the partner page', async () => {
    const partner = { program: 'Viking Deals', percent: 2, percentMax: 2, saving: 1.2, scope: 'All purchases', until: '2026-11-30', link: 'https://mobilevikings.be/en/viking-deals/partners/zooplus/' }
    const [best, ...rest] = offers
    const withDeal = { ...best!, suppliers: best!.suppliers.map((s) => ({ ...s, partner })) }
    await open([feliway({ picks: [withDeal, ...rest] })])
    const slip = pane().getByRole('group', { name: 'Best real offer' })
    expect(slip).toHaveTextContent('≈ € 58,75 after Viking Deals · 2% back on all purchases, until 30 Nov')
    expect(within(slip).getByRole('link', { name: /Open via Viking Deals/ })).toHaveAttribute('href', partner.link)
    expect(pane().getAllByRole('link', { name: /Open via/ })).toHaveLength(1)
  })
})
