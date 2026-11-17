import { describe, expect, it } from 'vitest'
import { parseListings, vikingDeals } from './vikingDeals'

const pct = (amount: number) => ({ amount, type: 'percentage', recurrence: 'once' })

const bol = {
  slug: 'bol-com',
  title: 'bol',
  is_published: true,
  cookie_rules: [],
  deals: [
    { deal_type: 'gift_card', value: pct(4), baseline_value: pct(4), description: 'All purchases', start_date: null, end_date: null },
    { deal_type: 'affiliate', value: pct(2.5), baseline_value: pct(2), description: 'All online purchases at <strong>bol</strong>', start_date: '2026-11-16', end_date: '2026-11-30' },
    { deal_type: 'affiliate', value: pct(1.5), baseline_value: pct(1.5), description: 'Game consoles', start_date: null, end_date: null },
    { deal_type: 'affiliate', value: pct(0), baseline_value: pct(0), description: 'No points for gift cards', start_date: null, end_date: null },
  ],
}

const fnac = {
  slug: 'fnac',
  title: 'FNAC',
  cookie_rules: [{ url: 'nl.fnac.be' }, { url: 'fr.fnac.be' }],
  deals: [{ deal_type: 'affiliate', value: pct(4), baseline_value: pct(4), description: 'All books', start_date: null, end_date: null }],
}

const energy = {
  slug: 'energie-be',
  title: 'Energie.be',
  deals: [{ deal_type: 'affiliate', value: { amount: 120, type: 'viking_points', recurrence: 'once' }, description: 'New contract' }],
}

describe('Viking Deals listings', () => {
  it('keeps online percentage deals, a promotion while it runs, and drops 0% rows and gift cards', () => {
    const [shop] = parseListings([bol], '2026-11-17')
    expect(shop).toEqual({
      hosts: [],
      names: ['bol-com', 'bol'],
      deals: [
        { percent: 2.5, scope: 'All online purchases at bol', until: '2026-11-30' },
        { percent: 1.5, scope: 'Game consoles', until: null },
      ],
      link: 'https://mobilevikings.be/en/viking-deals/partners/bol-com/',
    })
  })

  it('falls back to the baseline once a promotion has ended', () => {
    const [shop] = parseListings([bol], '2026-12-01')
    expect(shop?.deals[0]).toEqual({ percent: 2, scope: 'All online purchases at bol', until: null })
  })

  it('takes the shop hosts and leaves out unpublished shops and fixed-point deals', () => {
    expect(parseListings([fnac, energy, { ...bol, is_published: false }], '2026-11-17')).toEqual([
      expect.objectContaining({ hosts: ['nl.fnac.be', 'fr.fnac.be'], names: ['fnac', 'FNAC'] }),
    ])
  })

  it('rejects a list that is not an array', () => {
    expect(() => parseListings({ error: 'gone' }, '2026-11-17')).toThrow('not an array')
  })

  it('throws on an HTTP error', async () => {
    const fetchFn = (async () => new Response('nope', { status: 503 })) as typeof fetch
    await expect(vikingDeals.load(fetchFn, '2026-11-17')).rejects.toThrow('HTTP 503')
  })
})
